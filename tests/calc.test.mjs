// Run with: node tests/calc.test.mjs
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRow, resolveMark, computeGpa, gradeCourse, parseCsv, toCsv, parsePasted } from '../calc.js';

const data = JSON.parse(readFileSync(new URL('../data/scales.json', import.meta.url), 'utf8'));
const scale = (id) => data.scales.find((s) => s.id === id);
const P40 = data.gpaPoints['4.0'];
const P43 = data.gpaPoints['4.3'];
const tu40 = scale('tu-ug-pass40'); // scale 17

test('data has 17 scales with unique ids and the default exists', () => {
  assert.equal(data.scales.length, 17);
  assert.equal(new Set(data.scales.map((s) => s.id)).size, 17);
  assert.ok(scale(data.defaultScale));
});

test('scale 17, 4.0 points: fictional transcript gives 3.50', () => {
  // Invented marks (not a real student).
  const rows = [82, 68, 74, 61, 77, 71, 58, 66, 63, 85, 72].map((mark) => ({ credits: 3, mark }));
  rows.push({ credits: 6, mark: 88 });  // capstone project
  rows.push({ credits: 3, mark: 52 });  // falls in the C band
  // A/A+: 6 × 3 + 6 = 24 credits; B: 5 × 3 = 15; C: 3 → (96 + 45 + 6) / 42 = 3.50
  const r = computeGpa(tu40, rows, P40);
  assert.equal(r.totalCredits, 42);
  assert.equal(r.gpaText, '3.50');
  assert.equal(r.counts.ok, 13);
});

test('boundaries on scale 17', () => {
  assert.equal(findRow(tu40, 79.995).usGrade, 'A'); // rounding gap -> lower row
  assert.equal(findRow(tu40, 79.99).usGrade, 'A');
  assert.equal(findRow(tu40, 80).usGrade, 'A+');
  assert.equal(findRow(tu40, 70).usGrade, 'A');
  assert.equal(findRow(tu40, 69.999).usGrade, 'B');
  assert.equal(findRow(tu40, 0).usGrade, 'F');
  assert.equal(findRow(tu40, 100).usGrade, 'A+');
});

test('integer-range scale: 79.5 on Secondary 2016 is B+ (US B)', () => {
  const r = findRow(scale('secondary-2016'), 79.5);
  assert.equal(r.letter, 'B+');
  assert.equal(r.usGrade, 'B');
});

test('gap case: TU Master has no 40-49.99 row -> no mapping', () => {
  const master = scale('tu-master');
  assert.equal(findRow(master, 45), null);
  assert.equal(findRow(master, 39.99).usGrade, 'F');
  assert.equal(findRow(master, 39.995), null); // inside the wide gap
  assert.equal(findRow(master, 50).usGrade, 'B');
  const g = gradeCourse(master, { credits: 3, mark: 45 }, P40);
  assert.equal(g.status, 'nomap');
  const r = computeGpa(master, [{ credits: 3, mark: 45 }, { credits: 3, mark: 85 }], P40);
  assert.equal(r.totalCredits, 3);
  assert.equal(r.gpaText, '4.00');
});

test('overlap: 45.5 on TU Pass at 40 Alternate uses the higher row', () => {
  assert.equal(findRow(scale('tu-pass40-alternate'), 45.5).usGrade, 'B');
});

test('validation', () => {
  assert.ok(resolveMark(tu40, '101').error);
  assert.ok(resolveMark(tu40, '-1').error);
  assert.ok(resolveMark(tu40, 'abc').error);
  assert.equal(gradeCourse(tu40, { credits: 0, mark: 80 }, P40).status, 'invalid');
  assert.equal(gradeCourse(tu40, { credits: -3, mark: 80 }, P40).status, 'invalid');
  assert.equal(gradeCourse(tu40, { credits: '', mark: '' }, P40).status, 'empty');
});

test('letter scales and exclusions', () => {
  const uni = scale('university-level');
  const r = computeGpa(uni, [
    { credits: 3, mark: 'A' }, { credits: 3, mark: 'b-' }, { credits: 2, mark: 'NC' }, { credits: 3, mark: 'IN' },
  ], P40);
  assert.equal(r.counts.excluded, 2);
  assert.equal(r.totalCredits, 6);
  assert.equal(r.gpaText, '3.35');
  const ib = scale('ib-diploma');
  assert.equal(resolveMark(ib, '6.5').row.usGrade, 'A');
  assert.equal(resolveMark(ib, 'P').row.usGrade, 'S');
  assert.ok(resolveMark(ib, '8').error);
});

test('4.3 scale gives A+ 4.3', () => {
  const r = computeGpa(tu40, [{ credits: 3, mark: 90 }, { credits: 3, mark: 75 }], P43);
  assert.equal(r.gpaText, '4.15');
});

test('CSV round trip', () => {
  const rows = [{ name: 'Maths, I', credits: '3', mark: '81' }, { name: 'Say "hi"', credits: '6', mark: '88.5' }];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
  assert.deepEqual(parseCsv('Physics,3,70\n'), [{ name: 'Physics', credits: '3', mark: '70' }]);
});

test('paste from spreadsheet: tabs, commas, header, two columns', () => {
  assert.deepEqual(parsePasted('Course\tCredits\tMark\nCalculus I\t3\t78\nLab\t1.5\t85\t\t\n\n'), [
    { name: 'Calculus I', credits: '3', mark: '78' },
    { name: 'Lab', credits: '1.5', mark: '85' },
  ]);
  assert.deepEqual(parsePasted('"Maths, I",3,81'), [{ name: 'Maths, I', credits: '3', mark: '81' }]);
  assert.deepEqual(parsePasted('3\t70\n6\t88.5'), [
    { name: '', credits: '3', mark: '70' },
    { name: '', credits: '6', mark: '88.5' },
  ]);
  assert.deepEqual(parsePasted('Notes only\n'), []);
});

test('overall estimate maps one aggregate mark on the chosen scale', async () => {
  const { overallEstimate } = await import('../calc.js');
  assert.deepEqual(overallEstimate(tu40, '82', P40), { description: 'Distinction', usGrade: 'A+', counted: true, gradePoints: 4 });
  assert.equal(overallEstimate(tu40, '82', P43).gradePoints, 4.3);
  assert.equal(overallEstimate(tu40, '72.5', P40).usGrade, 'A');
  assert.deepEqual(overallEstimate(tu40, '', P40), { empty: true });
  assert.ok(overallEstimate(tu40, '120', P40).error);
  assert.ok(overallEstimate(tu40, 'abc', P40).error);
  const letter = data.scales.find((s) => s.type === 'letter');
  assert.deepEqual(overallEstimate(letter, '80', P40), { letterScale: true });
});

test('detail lines keep filled fields in order and drop blanks', async () => {
  const { detailLines } = await import('../calc.js');
  assert.deepEqual(detailLines({ name: '  Sample  Student ', university: 'Tribhuvan University', campus: '', regNo: '   ' }),
    [['Name', 'Sample Student'], ['University', 'Tribhuvan University']]);
  assert.deepEqual(detailLines({ programme: 'B.Sc. CSIT', name: 'A' }), [['Name', 'A'], ['Programme', 'B.Sc. CSIT']]);
  assert.deepEqual(detailLines(null), []);
  assert.deepEqual(detailLines({}), []);
});

test('spreadsheet export has a BOM, grade columns, and imports back', async () => {
  const { toSpreadsheetCsv } = await import('../calc.js');
  const rows = [{ name: 'Physics, Lab', credits: '1.5', mark: '85' }, { name: 'Maths', credits: '3', mark: '62' }];
  const csv = toSpreadsheetCsv(rows, computeGpa(tu40, rows, P40).results);
  assert.ok(csv.startsWith('﻿'));
  assert.equal(csv.split('\r\n')[1], '"Physics, Lab",1.5,85,A+,4.0');
  assert.equal(csv.split('\r\n')[2], 'Maths,3,62,B,3.0');
  assert.deepEqual(parseCsv(csv), rows);
});

test('faq.html matches data/faq.json (run npm run faq after editing)', async () => {
  const { applyFaq } = await import('../scripts/build-faq.mjs');
  const html = readFileSync(new URL('../faq.html', import.meta.url), 'utf8');
  const { questions } = JSON.parse(readFileSync(new URL('../data/faq.json', import.meta.url), 'utf8'));
  assert.ok(questions.length > 0 && questions.every((x) => x.q && x.a));
  assert.equal(applyFaq(html, questions), html);
});

test('marks out of more than 100 can be typed as marks/full marks', () => {
  const r = resolveMark(tu40, '187/200');
  assert.equal(r.mark, 93.5);
  assert.equal(r.row.usGrade, 'A+');
  assert.equal(resolveMark(tu40, ' 150 / 200 ').mark, 75);
  assert.match(resolveMark(tu40, '187').error, /187\/200/);
  assert.ok(resolveMark(tu40, '210/200').error);
  assert.ok(resolveMark(tu40, '5/0').error);
  // A 6-credit course out of 200 counts the same as entering its percentage.
  const a = computeGpa(tu40, [{ credits: 3, mark: '60' }, { credits: 6, mark: '187/200' }], P40);
  const b = computeGpa(tu40, [{ credits: 3, mark: '60' }, { credits: 6, mark: '93.5' }], P40);
  assert.equal(a.gpaText, b.gpaText);
  // Not on points scales (IB 0-7).
  assert.ok(resolveMark(scale('ib-diploma'), '6/7').error);
});

test('marks/full marks are exported and imported exactly as typed', async () => {
  const { toSpreadsheetCsv } = await import('../calc.js');
  const rows = [{ name: 'Internship', credits: '6', mark: '194/200' }, { name: 'Lab', credits: '1', mark: '12/20' }, { name: 'Maths', credits: '3', mark: '62' }];
  const csv = toSpreadsheetCsv(rows, computeGpa(tu40, rows, P40).results);
  assert.equal(csv.split('\r\n')[1], 'Internship,6,"=""194/200""",A+,4.0');
  assert.equal(csv.split('\r\n')[3], 'Maths,3,62,B,3.0');
  assert.deepEqual(parseCsv(csv), rows);
});
