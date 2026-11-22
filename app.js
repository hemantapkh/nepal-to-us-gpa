import { computeGpa, rangeRows, letterRows, scaleMax, parseCsv, parsePasted, toSpreadsheetCsv, overallEstimate, detailLines } from './calc.js';

const STORAGE_KEY = 'nepal-gpa-converter:v1';
const DETAILS_KEY = 'nepal-gpa-converter:details';
const $ = (id) => document.getElementById(id);

const state = { data: null, scaleId: null, points: '4.0', rows: [], demo: false, mode: 'courses', quick: '', details: {} };
let nextId = 1;
let lastStampText = null;
let courseResult = null;
// Rows whose problems may be shown: a row counts as "touched" once focus leaves it
// (or when it arrives already filled in, from storage, paste or import).
const touched = new WeakSet();
const markTouched = (rows) => rows.forEach((r) => touched.add(r));

// Public address printed on the PDF (empty = use the address the page was opened from).
const SITE_URL = 'https://gpa.hemantapkh.com';

// ---------- persistence ----------
function save() {
  if (state.demo) return; // never overwrite someone's saved courses with demo data
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      scaleId: state.scaleId,
      points: state.points,
      mode: state.mode,
      quick: state.quick,
      rows: state.rows.map(({ name, credits, mark }) => ({ name, credits, mark })),
    }));
  } catch { /* storage unavailable: ignore */ }
}

function load(key = STORAGE_KEY) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveDetails() {
  if (state.demo) return;
  try { localStorage.setItem(DETAILS_KEY, JSON.stringify(state.details)); } catch { /* ignore */ }
}

// The button names what it will do: add details, or edit the ones already there.
function updateDetailsButton() {
  const filled = Object.values(state.details || {}).some((v) => String(v ?? '').trim());
  document.getElementById('open-details').textContent = filled
    ? 'Edit your details on the PDF'
    : 'Add your name and degree to the PDF';
}

// ---------- helpers ----------
const scale = () => state.data.scales.find((s) => s.id === state.scaleId);
const points = () => state.data.gpaPoints[state.points];
const newRow = (r = {}) => ({ id: nextId++, name: String(r.name ?? ''), credits: String(r.credits ?? ''), mark: String(r.mark ?? '') });
const isBlank = (r) => !r.name.trim() && !r.credits.trim() && !r.mark.trim();
const STARTER_ROWS = 3; // empty rows ready to type into on a fresh page
const filledRows = () => state.rows.filter((r) => !isBlank(r));
const starterRows = () => Array.from({ length: STARTER_ROWS }, () => newRow());
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const num = (n) => String(Math.round(n * 100) / 100);
const isCounted = (usGrade) => Object.prototype.hasOwnProperty.call(points(), usGrade);
const markHead = (s) => (s.type === 'percentage' ? 'Mark %' : s.type === 'points' ? 'Points' : 'Grade');
const markName = (s) => (s.type === 'percentage' ? 'Mark' : s.type === 'points' ? 'Points' : 'Grade');

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

function setStatus(msg) {
  $('status').textContent = msg;
}

// ---------- scale picker + bands ----------
function renderScaleOptions() {
  const select = $('scale-select');
  select.replaceChildren(...state.data.scales.map((s) => el('option', { value: s.id, text: s.name })));
  select.value = state.scaleId;
}

function renderBands() {
  const s = scale();
  const hasLetter = s.rows.some((r) => r.letter);
  const hasRange = s.rows.some((r) => typeof r.min === 'number');
  const heads = [];
  if (hasLetter) heads.push('Nepal grade');
  if (hasRange) heads.push(s.type === 'points' ? 'Points' : 'Mark %');
  heads.push('Description', 'US grade', 'Points');

  const table = $('bands-table');
  table.tHead.replaceChildren(el('tr', {}, ...heads.map((h) => el('th', { scope: 'col', text: h }))));
  table.tBodies[0].replaceChildren(...[...rangeRows(s), ...letterRows(s)].map((r) => {
    const cells = [];
    if (hasLetter) cells.push(r.letter ?? '');
    if (hasRange) cells.push(typeof r.min === 'number' ? `${r.min}–${r.max}` : '');
    cells.push(r.description, r.usGrade, isCounted(r.usGrade) ? points()[r.usGrade].toFixed(1) : 'not counted');
    return el('tr', {}, ...cells.map((c) => el('td', { text: c })));
  }));

  const note = $('scale-note');
  note.hidden = !s.note;
  note.textContent = s.note || '';
  $('mark-head').textContent = markHead(s);
  $('bands-scale').textContent = `${s.name}, US ${state.points} scale`;
  $('quick-label').textContent = s.type === 'points' ? `Your overall points (0–${scaleMax(s)})` : 'Your overall percentage';
  // Keep the overall-percentage estimate in step with the chosen scale and 4.0/4.3 toggle.
  updateQuick();
}

// ---------- ledger ----------
function markControl(s, row, label, describedBy) {
  if (s.type === 'letter') {
    const match = s.rows.find((r) => r.letter.toLowerCase() === row.mark.trim().toLowerCase());
    const opts = [el('option', { value: '', text: 'Pick' })];
    if (row.mark && !match) opts.push(el('option', { value: row.mark, text: `${row.mark} (not on scale)` }));
    for (const r of s.rows) opts.push(el('option', { value: r.letter, text: r.letter }));
    const select = el('select', { 'aria-label': label, 'data-field': 'mark', 'aria-describedby': describedBy }, ...opts);
    select.value = match ? match.letter : row.mark;
    return select;
  }
  return el('input', {
    // Percentage marks can be typed as 187/200, so they get a keyboard with "/".
    type: 'text', inputmode: s.type === 'percentage' ? 'text' : 'decimal', autocomplete: 'off', value: row.mark, class: 'num',
    'aria-label': label, 'data-field': 'mark', 'aria-describedby': describedBy,
    placeholder: s.type === 'points' ? `0–${scaleMax(s)}` : '0–100',
  });
}

function renderRows() {
  const s = scale();
  $('course-rows').replaceChildren(...state.rows.map((row, i) => {
    const n = i + 1;
    const label = row.name || `course ${n}`;
    const msgId = `msg-${row.id}`;
    return el('tr', { 'data-id': row.id },
      el('td', { class: 'c-name' },
        el('input', { type: 'text', value: row.name, placeholder: `Course ${n}`, 'aria-label': `Course ${n} name`, 'data-field': 'name', autocomplete: 'off' }),
        el('span', { class: 'row-msg', id: msgId })),
      el('td', { class: 'c-credits', 'data-label': 'Credits' },
        el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'num', value: row.credits, placeholder: '3', 'aria-label': `Credits for ${label}`, 'data-field': 'credits', 'aria-describedby': msgId })),
      el('td', { class: 'c-mark', 'data-label': markHead(s) }, markControl(s, row, `${markName(s)} for ${label}`, msgId)),
      el('td', { class: 'c-us', 'data-label': 'US grade', 'data-out': 'us' }),
      el('td', { class: 'c-pts', 'data-label': 'Points', 'data-out': 'pts' }),
      el('td', { class: 'c-del' },
        el('button', { type: 'button', class: 'del', 'aria-label': `Remove ${label}`, title: 'Remove course', 'data-action': 'remove' },
          el('span', { 'aria-hidden': 'true', text: '×' }))),
    );
  }));
  $('mark-help').hidden = s.type !== 'percentage';
  $('empty-state').hidden = state.rows.length > 0;
  $('ledger-table').classList.toggle('is-empty', state.rows.length === 0);
  updateResults();
}

function updateResults() {
  const s = scale();
  const result = computeGpa(s, state.rows, points());
  const tbody = $('course-rows');

  result.results.forEach((r, i) => {
    const tr = tbody.children[i];
    if (!tr) return;
    // Problems still count against the GPA. Missing fields are only flagged once the row
    // is touched; a mark that is already wrong (e.g. 187 out of 100) is flagged right away,
    // since its message says how to fix it.
    const course = state.rows[i]; // r.row is the matched scale band, not the course
    const problem = r.status === 'invalid' || r.status === 'nomap';
    const markWrong = problem && String(course.mark).trim() !== '' && !/credit|^Enter /i.test(r.error);
    const bad = problem && (touched.has(course) || markWrong);
    tr.classList.toggle('has-error', bad);
    tr.classList.toggle('is-excluded', r.status === 'excluded');
    tr.querySelector('[data-out="us"]').textContent = r.usGrade ?? (r.status === 'nomap' ? 'None' : '');
    tr.querySelector('[data-out="pts"]').textContent = r.status === 'ok' ? r.gradePoints.toFixed(1) : r.status === 'excluded' ? 'n/c' : '';
    tr.querySelector('.row-msg').textContent = bad ? r.error : r.status === 'excluded' ? `${r.row.description}, not counted` : '';
    tr.querySelectorAll('[data-field="credits"], [data-field="mark"]').forEach((f) => {
      const fieldBad = bad && (f.dataset.field === 'credits' ? /credit/i.test(r.error) : !/credit/i.test(r.error));
      f.setAttribute('aria-invalid', fieldBad ? 'true' : 'false');
    });
  });

  courseResult = result;
  $('total-credits').textContent = num(result.totalCredits);
  $('total-courses').textContent = String(result.counts.ok);
  $('download-pdf').disabled = result.gpa == null;
  $('csv-export').disabled = !state.rows.some((r) => !isBlank(r));

  // Breakdown by US grade, in the order of the points table
  const byGrade = new Map();
  for (const r of result.results) {
    if (r.status !== 'ok') continue;
    const g = byGrade.get(r.usGrade) || { credits: 0, courses: 0 };
    g.credits += r.credits;
    g.courses += 1;
    byGrade.set(r.usGrade, g);
  }
  // One row per US grade this scale can produce, so the panel keeps its height
  // as courses come and go; only the numbers change.
  const onScale = new Set(s.rows.map((r) => r.usGrade));
  const order = Object.keys(points()).filter((g) => onScale.has(g));
  $('breakdown').tBodies[0].replaceChildren(...order.map((g) => el('tr', { class: byGrade.has(g) ? null : 'is-zero' },
    el('th', { scope: 'row', text: g }),
    el('td', { text: num(byGrade.get(g)?.credits ?? 0) }))));

  const c = result.counts;
  const parts = [];
  if (c.excluded) parts.push(`${plural(c.excluded, 'course')} marked pass or incomplete`);
  if (c.nomap) parts.push(`${plural(c.nomap, 'mark')} with no band on this scale`);
  if (c.invalid) parts.push(`${plural(c.invalid, 'row')} with missing or invalid credits or mark`);
  $('uncounted').textContent = parts.length ? `Not counted: ${parts.join('; ')}.` : '';

  renderReport(s, result);
  paintResult();
}

// ---------- result panel: shows whichever mode is active ----------
// Hide one of the two stacked results. On desktop CSS keeps it in the layout
// (invisible) so the panel height, and everything below it, stays put.
function setOff(el, off) {
  el.classList.toggle('is-off', off);
  el.inert = off;
  el.setAttribute('aria-hidden', String(off));
}

function paintResult() {
  const percent = state.mode === 'percent';
  let text = null;
  let barNote;
  let message = '';
  if (percent) {
    const q = overallEstimate(scale(), state.quick, points());
    if (q.usGrade && q.counted) text = q.gradePoints.toFixed(1);
    barNote = q.usGrade ? `US grade ${q.usGrade}` : '';
    $('percent-summary').textContent = q.usGrade
      ? `${state.quick.trim()}${scale().type === 'percentage' ? '%' : ' points'} is ${q.description}, roughly a US ${q.usGrade}${q.counted ? '' : ', which is not counted in a GPA'}.`
      : 'Enter your overall percentage to see the estimate.';
    if (text) message = `Overall ${state.quick.trim()}: ${q.description}, US grade ${q.usGrade}, ${text} on the ${state.points} scale.`;
  } else {
    const r = courseResult;
    if (r.gpa != null) text = r.gpaText;
    barNote = plural(num(r.totalCredits), 'credit');
    if (text) message = `Estimated GPA ${text} on the ${state.points} scale, ${barNote} counted.`;
  }

  $('stamp-title').textContent = percent ? 'Overall percentage' : 'Estimated US GPA';
  $('stamp-gpa').textContent = text ?? '–';
  $('stamp-scale').textContent = `${state.points} scale`;
  $('stamp-wrap').classList.toggle('is-empty', !text);
  $('bar-label').textContent = percent ? 'Estimated points' : 'Estimated GPA';
  $('bar-gpa').textContent = text ?? '–';
  $('bar-credits').textContent = barNote;
  setOff($('course-result'), percent);
  setOff($('percent-result'), !percent);

  const key = text && `${state.mode}:${text}`;
  if (key && key !== lastStampText) press();
  lastStampText = key;
  announce(message);
}

// Play the stamp animation once, after typing pauses, instead of on every keystroke.
let pressTimer;
function press() {
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    const w = $('stamp-wrap');
    w.classList.remove('press');
    requestAnimationFrame(() => w.classList.add('press'));
  }, 600);
}

let announceTimer;
function announce(text) {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => { $('gpa-live').textContent = text; }, 700);
}

// ---------- print report (always kept current, so printing needs no extra step) ----------
function renderReport(s, result) {
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  $('report-meta').textContent = `${s.name}, US ${state.points} scale. Prepared ${date}.`;
  renderReportDetails();

  const rows = state.rows.map((row, i) => ({ row, r: result.results[i] })).filter(({ r }) => r.status !== 'empty');
  const table = (part) => el('table', {},
    el('thead', {}, el('tr', {}, ...['Course', 'Credits', markHead(s), 'US', 'Points'].map((h) => el('th', { scope: 'col', text: h })))),
    el('tbody', {}, ...part.map(({ row, r }, i) => el('tr', {},
      el('td', { text: row.name || `Course ${i + 1}` }),
      el('td', { text: row.credits }),
      el('td', { text: row.mark }),
      el('td', { text: r.usGrade ?? (r.status === 'nomap' ? 'None' : '') }),
      el('td', { text: r.status === 'ok' ? r.gradePoints.toFixed(1) : r.status === 'excluded' ? 'n/c' : 'invalid' }),
    ))));
  const split = rows.length > 24 ? Math.ceil(rows.length / 2) : rows.length;
  const parts = split < rows.length ? [rows.slice(0, split), rows.slice(split)] : [rows];
  // number courses continuously across both columns
  let offset = 0;
  $('report-tables').replaceChildren(...parts.map((p) => {
    const t = table(p);
    t.querySelectorAll('tbody tr').forEach((tr, i) => {
      const { row } = p[i];
      if (!row.name) tr.firstChild.textContent = `Course ${offset + i + 1}`;
    });
    offset += p.length;
    return t;
  }));
  $('report-tables').classList.toggle('two-col', parts.length === 2);

  $('report-total').textContent = result.gpa == null ? 'No courses counted yet.'
    : `${plural(num(result.totalCredits), 'credit')} counted across ${plural(result.counts.ok, 'course')}. Estimated US GPA ${result.gpaText} on the ${state.points} scale.`;
  const stamp = $('stamp').cloneNode(true);
  stamp.removeAttribute('id');
  stamp.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  // keep the cloned textPaths pointing at unique arcs
  stamp.querySelectorAll('path').forEach((p, i) => p.setAttribute('id', `r-arc-${i}`));
  stamp.querySelectorAll('textPath').forEach((tp, i) => tp.setAttribute('href', `#r-arc-${i}`));
  // The report always carries the course-by-course GPA, whatever mode the page is in.
  stamp.querySelector('.stamp-num').textContent = result.gpa == null ? '–' : result.gpaText;
  const [top, bottom] = stamp.querySelectorAll('textPath');
  top.textContent = 'Estimated US GPA';
  bottom.textContent = `${state.points} scale`;
  stamp.querySelector('filter')?.remove();
  stamp.querySelector('g')?.removeAttribute('filter');
  $('report-stamp').replaceChildren(stamp);
}

function renderReportDetails() {
  const lines = detailLines(state.details);
  $('report-details').replaceChildren(...lines.map(([label, value]) => el('div', {},
    el('dt', { text: label }), el('dd', { text: value }))));
  $('report-details').hidden = lines.length === 0;
}

// The single line of links at the foot of the PDF.
function renderPrintLinks() {
  // Full https:// addresses as real links, so they are clickable in the saved PDF.
  const full = (u) => u.replace(/\/$/, '');
  const site = SITE_URL || `${location.origin}${location.pathname}`;
  const repo = 'https://github.com/hemantapkh/nepal-to-us-gpa';
  const link = (u) => el('a', { href: full(u), text: full(u) });
  $('print-links').replaceChildren(
    el('span', {}, 'Generated with ', link(site)),
    el('span', {}, 'Source code: ', link(repo)),
  );
}

// ---------- overall percentage ----------
function updateQuick() {
  const s = scale();
  const input = $('quick-mark');
  const err = $('quick-error');
  const q = overallEstimate(s, state.quick, points());
  input.disabled = Boolean(q.letterScale);
  input.setAttribute('aria-invalid', q.error ? 'true' : 'false');
  err.classList.toggle('is-info', Boolean(q.letterScale));
  err.textContent = q.letterScale ? 'This scale uses letter grades, so there is no overall percentage to convert. Use By course instead.'
    : q.error ? `${q.error}.` : '';
  $('quick-result').classList.toggle('is-empty', !q.usGrade);
  $('quick-desc').textContent = q.description ?? '–';
  $('quick-grade').textContent = q.usGrade ?? '–';
  $('quick-points').textContent = !q.usGrade ? '–'
    : q.counted ? `${q.gradePoints.toFixed(1)} on the ${state.points} scale` : 'Not counted in a GPA';
  if (courseResult) paintResult();
}

function setMode(mode) {
  state.mode = mode === 'percent' ? 'percent' : 'courses';
  document.querySelector(`input[name="mode"][value="${state.mode}"]`).checked = true;
  $('course-panel').hidden = state.mode !== 'courses';
  $('percent-panel').hidden = state.mode !== 'percent';
  updateQuick();
  paintResult();
}

// ---------- row events ----------
function rowOf(target) {
  const tr = target.closest('tr[data-id]');
  return tr ? { tr, row: state.rows.find((r) => r.id === Number(tr.dataset.id)) } : {};
}

function onRowInput(e) {
  const field = e.target.dataset.field;
  if (!field) return;
  const { tr, row } = rowOf(e.target);
  if (!row) return;
  row[field] = e.target.value;
  if (field === 'name') {
    const label = row.name || `course ${state.rows.indexOf(row) + 1}`;
    tr.querySelector('[data-action="remove"]').setAttribute('aria-label', `Remove ${label}`);
  }
  updateResults();
  save();
}

function focusField(index, field) {
  const tr = $('course-rows').children[index];
  const f = tr?.querySelector(`[data-field="${field}"]`);
  if (f) { f.focus(); f.select?.(); }
}

function onRowKey(e) {
  if (e.key !== 'Enter' || e.isComposing) return;
  const field = e.target.dataset.field;
  if (!field) return;
  e.preventDefault();
  const { row } = rowOf(e.target);
  const i = state.rows.indexOf(row);
  // Enter walks across the row, then on to the next course (adding one at the end).
  const order = ['name', 'credits', 'mark'];
  const nextField = order[order.indexOf(field) + 1];
  if (nextField) { focusField(i, nextField); return; }
  if (i === state.rows.length - 1) addRow(false);
  focusField(i + 1, 'name');
}

function addRow(focus = true) {
  state.rows.push(newRow());
  renderRows();
  save();
  if (focus) focusField(state.rows.length - 1, 'name');
}

function addRows(rows, replace = false) {
  state.rows = [...(replace ? [] : filledRows()), ...rows.map(newRow)];
  markTouched(state.rows);
  renderRows();
  save();
}

// ---------- replace or add (asked only when there are courses already) ----------
function setupChoice(prefix) {
  const n = filledRows().length;
  $(`${prefix}-choice`).hidden = n === 0;
  $(`${prefix}-legend`).textContent = `You already have ${plural(n, 'course')}`;
  document.querySelector(`input[name="${prefix}-how"][value="replace"]`).checked = true;
}
const choosesReplace = (prefix) => filledRows().length === 0
  || document.querySelector(`input[name="${prefix}-how"]:checked`).value === 'replace';
const actionLabel = (prefix, n) => (filledRows().length && choosesReplace(prefix)
  ? `Replace with ${plural(n, 'course')}` : `Add ${plural(n, 'course')}`);

// ---------- paste dialog ----------
function updatePastePreview() {
  const rows = parsePasted($('paste-text').value);
  const s = scale();
  const result = computeGpa(s, rows, points());
  const bad = result.counts.invalid + result.counts.nomap;
  const btn = $('paste-add');
  btn.disabled = rows.length === 0;
  btn.textContent = rows.length ? actionLabel('paste', rows.length) : 'Add courses';
  $('paste-count').textContent = rows.length === 0
    ? ($('paste-text').value.trim() ? 'No courses found. Each line needs credits and a mark.' : 'Nothing pasted yet.')
    : `Found ${plural(rows.length, 'course')}.${bad ? ` ${bad === 1 ? '1 row needs' : `${bad} rows need`} a fix after adding.` : ''}`;
}

// ---------- CSV ----------
function exportCsv() {
  const rows = state.rows.filter((r) => !isBlank(r));
  const blob = new Blob([toSpreadsheetCsv(rows, computeGpa(scale(), rows, points()).results)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: 'gpa-courses.csv' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus(`Downloaded ${plural(rows.length, 'course')} as a spreadsheet.`);
}

// ---------- mobile result sheet ----------
function setSheet(open) {
  $('result').classList.toggle('is-open', open);
  $('result-bar').setAttribute('aria-expanded', String(open));
  $('bar-toggle').textContent = open ? 'Hide' : 'Details';
}

function bind() {
  $('scale-select').addEventListener('change', (e) => {
    state.scaleId = e.target.value;
    renderBands();
    renderRows();
    save();
  });
  document.querySelectorAll('input[name="points"]').forEach((r) => r.addEventListener('change', (e) => {
    state.points = e.target.value;
    renderBands();
    updateResults();
    save();
  }));

  const rows = $('course-rows');
  rows.addEventListener('input', onRowInput);
  rows.addEventListener('change', onRowInput);
  rows.addEventListener('keydown', onRowKey);
  // Show a row's problems only after the user leaves it, not while they're still typing.
  rows.addEventListener('focusout', (e) => {
    const { tr, row } = rowOf(e.target);
    if (!row || (e.relatedTarget && tr.contains(e.relatedTarget))) return;
    touched.add(row);
    updateResults();
  });
  rows.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="remove"]');
    if (!btn) return;
    const { row } = rowOf(btn);
    const idx = state.rows.indexOf(row);
    state.rows.splice(idx, 1);
    renderRows();
    save();
    const next = rows.children[Math.min(idx, rows.children.length - 1)];
    (next?.querySelector('[data-action="remove"]') || $('add-row')).focus();
  });

  $('add-row').addEventListener('click', () => addRow());

  const dialog = $('paste-dialog');
  $('open-paste').addEventListener('click', () => {
    $('paste-text').value = '';
    setupChoice('paste');
    updatePastePreview();
    dialog.showModal();
  });
  $('paste-text').addEventListener('input', updatePastePreview);
  $('paste-choice').addEventListener('change', updatePastePreview);
  dialog.addEventListener('close', () => {
    if (dialog.returnValue !== 'add') return;
    const pasted = parsePasted($('paste-text').value);
    if (!pasted.length) return;
    const replace = choosesReplace('paste');
    addRows(pasted, replace);
    setStatus(`${replace ? 'Replaced with' : 'Added'} ${plural(pasted.length, 'course')}.`);
    $('open-paste').focus();
  });

  const menu = $('more-menu');
  document.addEventListener('click', (e) => { if (menu.open && !menu.contains(e.target)) menu.open = false; });
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { menu.open = false; menu.querySelector('summary').focus(); } });
  $('csv-export').addEventListener('click', exportCsv);
  $('csv-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    menu.open = false;
    if (!file) return;
    try {
      const imported = parseCsv(await file.text());
      if (!imported.length) setStatus('No courses found in that file.');
      else if (!filledRows().length) importRows(imported, true);
      else {
        pendingImport = imported;
        setupChoice('import');
        $('import-count').textContent = `Found ${plural(imported.length, 'course')} in ${file.name}.`;
        updateImportButton();
        importDialog.showModal();
      }
    } catch { setStatus('Could not read that file.'); }
    e.target.value = '';
  });
  const importDialog = $('import-dialog');
  let pendingImport = null;
  const updateImportButton = () => { $('import-go').textContent = actionLabel('import', pendingImport.length); };
  const importRows = (rows, replace) => {
    const hadCourses = filledRows().length > 0;
    addRows(rows, replace);
    setStatus(`${hadCourses && replace ? 'Replaced with' : 'Imported'} ${plural(rows.length, 'course')}.`);
  };
  $('import-choice').addEventListener('change', updateImportButton);
  importDialog.addEventListener('close', () => {
    if (importDialog.returnValue === 'import' && pendingImport) importRows(pendingImport, choosesReplace('import'));
    pendingImport = null;
    $('more-menu').querySelector('summary').focus();
  });
  $('clear-rows').addEventListener('click', () => {
    menu.open = false;
    const n = filledRows().length;
    if (!n || !confirm(`Remove all ${plural(n, 'course')}? This can’t be undone.`)) return;
    state.rows = starterRows();
    renderRows();
    save();
    setStatus('All courses removed.');
    focusField(0, 'name');
  });

  $('quick-mark').addEventListener('input', (e) => { state.quick = e.target.value; updateQuick(); save(); });
  document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', (e) => {
    setMode(e.target.value);
    save();
  }));

  // Grade bands dialog: a native modal keeps focus inside and closes on Esc.
  const bands = $('bands-dialog');
  $('open-bands').addEventListener('click', () => bands.showModal());
  $('close-bands').addEventListener('click', () => bands.close());
  bands.addEventListener('click', (e) => { if (e.target === bands) bands.close(); }); // backdrop
  bands.addEventListener('close', () => $('open-bands').focus());

  // Optional student details, printed on the PDF only, edited in a dialog.
  const detailsDlg = $('details-dialog');
  $('open-details').addEventListener('click', () => detailsDlg.showModal());
  $('close-details').addEventListener('click', () => detailsDlg.close());
  detailsDlg.addEventListener('click', (e) => { if (e.target === detailsDlg) detailsDlg.close(); });
  detailsDlg.addEventListener('close', () => { updateDetailsButton(); $('open-details').focus(); });
  updateDetailsButton();
  document.querySelectorAll('[data-detail]').forEach((input) => {
    input.value = state.details[input.dataset.detail] ?? '';
    input.addEventListener('input', () => {
      state.details[input.dataset.detail] = input.value;
      renderReportDetails();
      saveDetails();
    });
  });

  $('result-bar').addEventListener('click', () => setSheet(!$('result').classList.contains('is-open')));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.querySelector('dialog[open]') && $('result').classList.contains('is-open')) { setSheet(false); $('result-bar').focus(); }
  });

  // PDF export: the print stylesheet turns the page into a one-page report.
  const title = document.title;
  window.addEventListener('beforeprint', () => { document.title = 'GPA estimate'; });
  window.addEventListener('afterprint', () => { document.title = title; });
  $('download-pdf').addEventListener('click', () => {
    document.title = 'GPA estimate';
    window.print();
    document.title = title;
  });
}

// ---------- demo data (?demo=1): fictional, not saved ----------
// The TU B.Sc. CSIT course list (126 credits) with invented marks, not a real student.
const DEMO = [
  ['Introduction to Information Technology', 3, 88], ['C Programming', 3, 84], ['Digital Logic', 3, 79], ['Mathematics I', 3, 76], ['Physics', 3, 81],
  ['Discrete Structure', 3, 78], ['Object Oriented Programming', 3, 86], ['Microprocessor', 3, 74], ['Mathematics II', 3, 72], ['Statistics I', 3, 77],
  ['Data Structures and Algorithms', 3, 83], ['Numerical Method', 3, 71], ['Computer Architecture', 3, 75], ['Computer Graphics', 3, 69], ['Statistics II', 3, 80],
  ['Theory of Computation', 3, 73], ['Computer Networks', 3, 82], ['Operating Systems', 3, 85], ['Database Management System', 3, 87], ['Artificial Intelligence', 3, 78],
  ['Design and Analysis of Algorithms', 3, 76], ['System Analysis and Design', 3, 84], ['Cryptography', 3, 72], ['Simulation and Modeling', 3, 79], ['Web Technology', 3, 88], ['Image Processing', 3, 74],
  ['Software Engineering', 3, 81], ['Compiler Design and Construction', 3, 70], ['E-Governance', 3, 77], ['NET Centric Computing', 3, 75], ['Technical Writing', 3, 83], ['E-Commerce', 3, 79],
  ['Advanced Java Programming', 3, 78], ['Data Warehousing and Data Mining', 3, 80], ['Principles of Management', 3, 74], ['Project Work', 3, 92], ['Software Project Management', 3, 82],
  ['Advanced Database', 3, 84], ['Internship', 6, 90], ['Introduction to Cloud Computing', 3, 86], ['International Business Management', 3, 68],
].map(([name, credits, mark]) => ({ name, credits, mark }));
const DEMO_OVERALL = '81.6';
const DEMO_DETAILS = { name: 'Sample Student', university: 'Tribhuvan University', programme: 'B.Sc. CSIT' };

// ---------- init ----------
async function init() {
  try {
    const res = await fetch('data/scales.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
  } catch (err) {
    const box = $('load-error');
    box.hidden = false;
    box.textContent = `Could not load the grading scales (${err.message}). If you opened the file directly, serve the folder instead: python3 -m http.server`;
    return;
  }

  const params = new URLSearchParams(location.search);
  state.demo = params.has('demo');
  const saved = state.demo ? null : load();
  const valid = (id) => state.data.scales.some((s) => s.id === id);
  state.scaleId = saved && valid(saved.scaleId) ? saved.scaleId : state.data.defaultScale;
  state.points = saved && state.data.gpaPoints[saved.points] ? saved.points : '4.0';
  state.quick = state.demo ? DEMO_OVERALL : typeof saved?.quick === 'string' ? saved.quick : '';
  state.details = state.demo ? { ...DEMO_DETAILS } : load(DETAILS_KEY) || {};
  $('quick-mark').value = state.quick;
  const source = state.demo ? DEMO : Array.isArray(saved?.rows) ? saved.rows : [];
  state.rows = source.map(newRow).filter((r) => !isBlank(r));
  markTouched(state.rows);
  if (!state.rows.length) state.rows = starterRows();
  document.querySelector(`input[name="points"][value="${state.points}"]`).checked = true;

  renderScaleOptions();
  renderBands();
  renderRows();
  renderPrintLinks();
  bind();
  // ?mode=percent opens the overall-percentage view without changing what is saved.
  setMode(params.get('mode') || saved?.mode);
  if (params.has('sheet')) setSheet(true);
}

init();
