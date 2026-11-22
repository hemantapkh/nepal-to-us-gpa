// Pure GPA logic, shared by the browser (app.js) and the Node tests.
// No DOM access here.

// Two adjacent rows separated by at most this many points (e.g. 79.99 -> 80,
// or 79 -> 80 on integer scales) are treated as a rounding gap: a mark in it
// belongs to the lower row. Wider gaps (e.g. TU Master's missing 40-49.99 row)
// are real gaps and give "no mapping".
export const ROUNDING_GAP = 1;
const EPS = 1e-9;

export function isRangeRow(row) {
  return typeof row.min === 'number' && typeof row.max === 'number';
}

/** Range rows sorted by min, highest first. */
export function rangeRows(scale) {
  return scale.rows.filter(isRangeRow).sort((a, b) => b.min - a.min);
}

/** Rows identified only by a letter/label (no numeric range). */
export function letterRows(scale) {
  return scale.rows.filter((r) => !isRangeRow(r));
}

/** Highest valid mark for a numeric scale (100 for percentages). */
export function scaleMax(scale) {
  if (scale.type === 'percentage') return 100;
  return Math.max(...rangeRows(scale).map((r) => r.max));
}

/**
 * Find the row for a numeric mark. Rows are checked from the highest min down;
 * the first row with min <= mark <= max wins (so published overlaps resolve to
 * the higher row). A mark just above a row's max but below the next row's min
 * is assigned to that row when the gap is a rounding gap. Returns null if none.
 */
export function findRow(scale, mark) {
  const rows = rangeRows(scale);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (mark < row.min - EPS) continue;
    if (mark <= row.max + EPS) return row;
    const upper = i > 0 ? rows[i - 1] : null;
    if (upper && mark < upper.min && upper.min - row.max <= ROUNDING_GAP + EPS) return row;
    return null; // above this row's max, in a real gap (or above the top row)
  }
  return null;
}

function findLetterRow(rows, value) {
  const v = String(value).trim().toLowerCase();
  return rows.find((r) => String(r.letter).toLowerCase() === v) || null;
}

/**
 * Resolve a raw mark (string or number) on a scale.
 * Returns { row } or { error } or { empty: true }.
 */
export function resolveMark(scale, raw) {
  const text = raw == null ? '' : String(raw).trim();
  if (text === '') return { empty: true };

  if (scale.type === 'letter') {
    const row = findLetterRow(scale.rows, text);
    return row ? { row } : { error: `"${text}" is not a grade on this scale` };
  }

  // Numeric scales may also have label-only rows (e.g. IB "P").
  const labelRow = findLetterRow(letterRows(scale), text);
  if (labelRow) return { row: labelRow };

  // Percentage scales also accept "marks/full marks", e.g. 187/200 for a 200-mark course.
  const NUM = '(\\d+\\.?\\d*|\\.\\d+)';
  const frac = scale.type === 'percentage' && text.match(new RegExp(`^${NUM}\\s*/\\s*${NUM}$`));
  if (frac) {
    const [got, full] = [Number(frac[1]), Number(frac[2])];
    if (!(full > 0)) return { error: 'Full marks must be more than 0' };
    if (got > full) return { error: 'Marks can’t be more than the full marks' };
    const pct = Math.round((got / full) * 10000) / 100;
    const row = findRow(scale, pct);
    return row ? { row, mark: pct } : { error: 'No mapping for this mark on this scale', noMapping: true };
  }

  const mark = Number(text);
  if (!Number.isFinite(mark) || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) {
    return { error: 'Mark must be a number' };
  }
  const max = scaleMax(scale);
  if (scale.type === 'percentage' && mark > 100) {
    return { error: 'Over 100? Type it as marks/full marks, e.g. 187/200' };
  }
  if (mark < 0 || mark > max) return { error: `Mark must be between 0 and ${max}` };
  const row = findRow(scale, mark);
  return row ? { row, mark } : { error: 'No mapping for this mark on this scale', noMapping: true };
}

/** Validate credits; returns { credits } or { error } or { empty: true }. */
export function resolveCredits(raw) {
  const text = raw == null ? '' : String(raw).trim();
  if (text === '') return { empty: true };
  const credits = Number(text);
  if (!Number.isFinite(credits) || credits <= 0) return { error: 'Credits must be greater than 0' };
  return { credits };
}

/**
 * Grade one course. status is one of:
 *  'ok' | 'excluded' (e.g. Pass/Incomplete) | 'nomap' | 'invalid' | 'empty'
 */
export function gradeCourse(scale, course, points) {
  const c = resolveCredits(course.credits);
  const m = resolveMark(scale, course.mark);
  if (c.empty && m.empty) return { status: 'empty' };
  if (c.error) return { status: 'invalid', error: c.error };
  if (c.empty) return { status: 'invalid', error: 'Enter credits' };
  if (m.empty) return { status: 'invalid', error: 'Enter a mark' };
  if (m.noMapping) return { status: 'nomap', error: m.error, credits: c.credits };
  if (m.error) return { status: 'invalid', error: m.error };

  const usGrade = m.row.usGrade;
  if (!Object.prototype.hasOwnProperty.call(points, usGrade)) {
    return { status: 'excluded', row: m.row, usGrade, credits: c.credits };
  }
  return { status: 'ok', row: m.row, usGrade, gradePoints: points[usGrade], credits: c.credits };
}

/** Credit-weighted GPA over all courses with status 'ok'. */
export function computeGpa(scale, courses, points) {
  const results = courses.map((course) => gradeCourse(scale, course, points));
  let credits = 0;
  let qualityPoints = 0;
  const counts = { ok: 0, excluded: 0, nomap: 0, invalid: 0, empty: 0 };
  for (const r of results) {
    counts[r.status]++;
    if (r.status === 'ok') {
      credits += r.credits;
      qualityPoints += r.credits * r.gradePoints;
    }
  }
  const gpa = credits > 0 ? qualityPoints / credits : null;
  return {
    results,
    counts,
    totalCredits: credits,
    qualityPoints,
    gpa,
    gpaText: gpa == null ? '—' : formatGpa(gpa),
  };
}

export function formatGpa(gpa) {
  // Round half up at 2 decimals, guarding against binary float drift.
  return (Math.round((gpa + EPS) * 100) / 100).toFixed(2);
}

// ---------- CSV ----------

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Parse "course,credits,mark" CSV (header optional). Returns rows of strings. */
export function parseCsv(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const rows = lines.map(parseCsvLine);
  if (rows.length && /^credits?$/i.test(rows[0][1] || '')) rows.shift();
  return rows.map(([name = '', credits = '', mark = '']) => ({ name, credits, mark }));
}

function csvField(value) {
  const s = value == null ? '' : String(value);
  // Neutralise spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(courses) {
  const lines = ['course,credits,mark'];
  for (const c of courses) lines.push([c.name, c.credits, c.mark].map(csvField).join(','));
  return lines.join('\n') + '\n';
}

/**
 * Parse rows pasted from a spreadsheet (Excel / Google Sheets copy gives
 * tab-separated lines; comma-separated also works). Columns:
 *   course, credits, mark   — or just — credits, mark
 * A header row is skipped. Lines with no credits and no mark are dropped.
 */
export function parsePasted(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const rows = lines.map((l) => (l.includes('\t') ? l.split('\t').map((s) => s.trim()) : parseCsvLine(l)));
  if (rows.length && rows[0].some((c) => /^credits?(\s*hours?)?$/i.test(c))) rows.shift();
  return rows
    .map((cells) => {
      while (cells.length > 1 && cells[cells.length - 1] === '') cells.pop();
      if (cells.length === 2) return { name: '', credits: cells[0], mark: cells[1] };
      const [name = '', credits = '', mark = ''] = cells;
      return { name, credits, mark };
    })
    .filter((r) => r.credits !== '' || r.mark !== '');
}

/**
 * Estimate from a single overall mark (percentage or points).
 * Returns { empty } | { error } | { letterScale } |
 *         { description, usGrade, counted, gradePoints }.
 */
export function overallEstimate(scale, raw, points) {
  if (scale.type === 'letter') return { letterScale: true };
  const m = resolveMark(scale, raw);
  if (m.empty) return { empty: true };
  if (m.error) return { error: m.error };
  const { description, usGrade } = m.row;
  const counted = Object.prototype.hasOwnProperty.call(points, usGrade);
  return { description, usGrade, counted, gradePoints: counted ? points[usGrade] : null };
}

/** Optional student details for the PDF, in print order. */
export const DETAIL_FIELDS = [
  ['name', 'Name'],
  ['university', 'University'],
  ['programme', 'Programme'],
  ['campus', 'Campus'],
  ['regNo', 'Registration no.'],
];

/** The filled-in details as [label, value] pairs; blank fields are left out. */
export function detailLines(details) {
  if (!details || typeof details !== 'object') return [];
  return DETAIL_FIELDS
    .map(([key, label]) => [label, String(details[key] ?? '').trim().replace(/\s+/g, ' ')])
    .filter(([, value]) => value !== '');
}

/**
 * Spreadsheet export: the course columns (so Import CSV reads it back) plus the
 * US grade and grade points. Starts with a UTF-8 byte-order mark so Excel opens
 * names in Devanagari or with accents correctly.
 */
export function toSpreadsheetCsv(courses, results) {
  const lines = ['course,credits,mark,us_grade,grade_points'];
  courses.forEach((c, i) => {
    const r = results[i] || {};
    const pts = r.status === 'ok' ? r.gradePoints.toFixed(1) : r.status === 'excluded' ? 'not counted' : '';
    lines.push([c.name, c.credits, c.mark, r.usGrade ?? '', pts].map(csvField).join(','));
  });
  return '﻿' + lines.join('\r\n') + '\r\n';
}
