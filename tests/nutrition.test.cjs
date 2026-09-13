const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../nutrition.js');
const meal = (overrides = {}) => ({ id: 'test', date: '2026-09-12', meal: 'Lunch', items: 'Test food', kcal: 500, protein: 25, carbs: 50, fat: 15, notes: '', bundled: false, ...overrides });
const summary = (overrides = {}) => ({ date: '2026-09-12', kcal: 500, target: '2100–2300', weight: null, ...overrides });
const table = (cols, rows) => ({ cols: cols.map(label => ({ label })), rows: rows.map(c => ({ c: c.map(v => v === null ? null : typeof v === 'object' ? v : ({ v })) })) });

test('dates accept Sheets values and reject impossible dates', () => {
  assert.equal(N.isoDate('Date(2026,8,12)'), '2026-09-12');
  assert.equal(N.isoDate('Date(2026,8,12,0,0,0)'), '2026-09-12');
  assert.equal(N.isoDate('9/12/2026'), '2026-09-12');
  assert.equal(N.isoDate('2026-02-30'), null);
  assert.equal(N.isoDate('Date(2026,12,1)'), null);
});
test('calendar boundaries use the selected timezone, including midnight', () => {
  assert.equal(N.today('America/New_York', new Date('2026-09-13T02:00:00Z')), '2026-09-12');
  assert.equal(N.today('Asia/Kolkata', new Date('2026-09-13T02:00:00Z')), '2026-09-13');
  assert.deepEqual(N.rangeDates('2026-03-09', 3), ['2026-03-07', '2026-03-08', '2026-03-09']);
});
test('unknown numeric values stay unknown; explicit zero is retained', () => {
  assert.equal(N.number(null), null); assert.equal(N.number(''), null);
  assert.equal(N.number('N/A'), null); assert.equal(N.number('200oops'), null);
  assert.equal(N.number(-10), null); assert.equal(N.number(Infinity), null);
  assert.equal(N.number('0'), 0); assert.equal(N.number('1,250'), 1250);
});
test('Sheet targets handle separators and reject reversed ranges', () => {
  assert.deepEqual(N.parseTarget('2,100–2,300'), [2100, 2300]);
  assert.deepEqual(N.parseTarget('1900 - 2200'), [1900, 2200]);
  assert.deepEqual(N.parseTarget('2300–2100', [1800, 2000]), [1800, 2000]);
});
test('GViz responses are parsed as data, never executable JavaScript', () => {
  assert.deepEqual(N.parseGviz('/*O_o*/\ngoogle.visualization.Query.setResponse({"status":"ok","table":{"cols":[],"rows":[]}});'), { cols: [], rows: [] });
  assert.throws(() => N.parseGviz('<html>Sign in</html>'));
  assert.throws(() => N.parseGviz('{"status":"error"}'));
});
test('header mapping and raw Sheets date values survive locale formatting', () => {
  const parsed = N.parseMeals(table(['Meal', 'Date', 'Time', 'Items', 'Calories (est)', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Photo', 'Notes'], [['Lunch', { v: 'Date(2026,8,12)', f: '12 Sept 2026' }, null, 'Food', 500, 25, 50, 15, 'No', '']]));
  assert.equal(parsed[0].date, '2026-09-12'); assert.equal(parsed[0].meal, 'Lunch');
  assert.equal(parsed[0].kcal, 500);
});
test('explicitly included add-on macros do not become missing or get counted twice', () => {
  const rows = N.parseMeals(table([], [
    ['2026-09-12', 'Dinner', '', 'Main meal', 1000, 60, 90, 40, 'No', ''],
    ['2026-09-12', 'Dinner add-on', '', 'Side', 175, null, null, null, 'No', 'Counted in dinner macros above']
  ]));
  const day = N.buildDays(rows, [summary({ kcal: 1175 })])[0];
  assert.equal(day.kcal, 1175); assert.equal(day.protein, 60);
  assert.equal(day.proteinPartial, false); assert.equal(day.bundledCount, 1);
});
test('ordinary blank macros are not silently interpreted as included', () => {
  const day = N.buildDays([meal(), meal({ protein: null, notes: 'Unknown protein' })], [summary({ kcal: 1000 })])[0];
  assert.equal(day.protein, 25); assert.equal(day.proteinPartial, true);
  assert.equal(N.proteinStatus(day, 128).state, 'partial');
  assert.equal(day.macroEnergy, null);
});
test('known partial protein can establish that a target has already been reached', () => {
  const day = N.buildDays([meal({ protein: 140 }), meal({ protein: null })], [summary({ kcal: 1000 })])[0];
  assert.deepEqual(N.proteinStatus(day, 128), { state: 'met', delta: 12 });
});
test('the meal total wins over a conflicting daily summary, with a review flag', () => {
  const day = N.buildDays([meal({ kcal: 700 }), meal({ kcal: 800 })], [summary({ kcal: 1000 })])[0];
  assert.equal(day.kcal, 1500); assert.equal(day.summaryCalories, 1000);
  assert.equal(day.summaryMismatch, true); assert.equal(day.calorieSource, 'meals');
});
test('missing meal calories use the summary when available; otherwise stay partial', () => {
  const meals = [meal(), meal({ kcal: null })];
  const complete = N.buildDays(meals, [summary({ kcal: 900 })])[0];
  assert.equal(complete.kcal, 900); assert.equal(complete.calorieSource, 'summary');
  assert.equal(complete.caloriePartial, false);
  const partial = N.buildDays(meals, [])[0];
  assert.equal(partial.kcal, 500); assert.equal(N.calorieStatus(partial).state, 'partial');
});
test('calorie range comparisons include both boundaries and calculate overage from the upper target', () => {
  const base = N.emptyDay('2026-09-12');
  assert.deepEqual(N.calorieStatus({ ...base, kcal: 3095 }), { state: 'above', delta: 795 });
  assert.equal(N.calorieStatus({ ...base, kcal: 2100 }).state, 'within');
  assert.equal(N.calorieStatus({ ...base, kcal: 2300 }).state, 'within');
  assert.deepEqual(N.calorieStatus({ ...base, kcal: 1680 }), { state: 'below', delta: 420 });
  assert.equal(N.calorieStatus(base).state, 'empty');
});
test('provisional protein target is a goal, so exceeding it remains goal met', () => {
  assert.deepEqual(N.proteinStatus({ protein: 203, proteinPartial: false }, 128), { state: 'met', delta: 75 });
});
test('unlogged calendar days and missing macros are excluded from averages', () => {
  const days = N.buildDays([meal({ date: '2026-09-11', kcal: 1000 }), meal({ kcal: 2000, protein: null })], []);
  const stats = N.windowStats(days, '2026-09-13', 7, 128);
  assert.equal(stats.dates.length, 7); assert.equal(stats.logged, 2);
  assert.equal(stats.averageCalories, 1500); assert.equal(stats.averageProtein, 25);
  assert.equal(stats.proteinDays.length, 1);
});
test('actual zero-calorie records are retained in averages', () => {
  const day = N.buildDays([meal({ kcal: 0, protein: 0, carbs: 0, fat: 0 })], [summary({ kcal: 0 })]);
  assert.equal(N.windowStats(day, '2026-09-12', 7, 128).averageCalories, 0);
  assert.equal(day[0].macroEnergy, 0);
});
test('weight-only rows never count as food logging days', () => {
  const day = N.buildDays([], [summary({ kcal: null, weight: 95 })]);
  assert.equal(N.windowStats(day, '2026-09-12', 7, 128).logged, 0);
});
test('weight uses observations only, supports either direction, and has no fabricated trend', () => {
  const one = N.weightStats([summary({ weight: 95.2 })], '2026-09-12', 80);
  assert.equal(one.points.length, 1); assert.equal(one.change, null); assert.equal(one.progress, 0);
  assert.ok(Math.abs(one.distance - 15.2) < .0001);
  assert.equal(N.weightStats([summary({ weight: 95.2 })], '2026-09-11', 80).latest, null);
  const gain = N.weightStats([summary({ date: '2026-09-11', weight: 50 }), summary({ weight: 55 })], '2026-09-12', 60);
  assert.equal(gain.progress, 50);
});
test('historical Sheet targets and explicit local overrides are kept distinct', () => {
  const daily = [summary({ target: '1900–2000' })];
  assert.deepEqual(N.buildDays([meal()], daily)[0].target, [1900, 2000]);
  assert.deepEqual(N.buildDays([meal()], daily, { ...N.DEFAULTS, sheetTargets: false, calorieLow: 1800, calorieHigh: 1900 })[0].target, [1800, 1900]);
});
