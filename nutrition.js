/* Pure data and calculation layer. No network, UI, or storage dependencies. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nutrition = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DEFAULTS = Object.freeze({ calorieLow: 2100, calorieHigh: 2300, protein: 128, weight: 80, sheetTargets: true, proteinReviewed: false, timezone: 'America/New_York' });
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  function number(value) {
    if (finite(value)) return value >= 0 ? value : null;
    if (value == null || value === '') return null;
    const text = String(value).trim().replace(/,/g, '').replace(/^[~≈]\s*/, '');
    if (!/^\d+(?:\.\d+)?(?:\s*(?:kcal|kg|g))?$/i.test(text)) return null;
    const n = parseFloat(text);
    return finite(n) ? n : null;
  }
  function isoDate(value) {
    if (value == null) return null;
    const str = String(value).trim();
    let parts;
    const google = str.match(/^Date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})(?:,.*)?\)$/);
    const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const us = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (google) parts = [+google[1], +google[2] + 1, +google[3]];
    else if (iso) parts = [+iso[1], +iso[2], +iso[3]];
    else if (us) parts = [+us[3], +us[1], +us[2]];
    else return null;
    const [y, m, d] = parts;
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  function today(timezone = DEFAULTS.timezone, now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function shiftDate(iso, days) {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function rangeDates(end, count) { return Array.from({ length: count }, (_, i) => shiftDate(end, i - count + 1)); }
  function fmtDate(iso, options = {}) {
    if (!isoDate(iso)) return 'Unknown date';
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', ...options });
  }
  function cell(row, i, raw = false) {
    const c = row && row.c && row.c[i];
    if (!c) return null;
    return raw ? c.v : (c.f != null && c.f !== '' ? c.f : c.v);
  }
  function rowDate(row, i) { return isoDate(cell(row, i, true)) || isoDate(cell(row, i)); }
  function column(table, names, fallback) {
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const keys = names.map(norm);
    const index = (table.cols || []).findIndex(c => keys.includes(norm(c.label)));
    return index < 0 ? fallback : index;
  }
  function parseGviz(text) {
    const start = text.indexOf('{'), end = text.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error('The Sheet did not return readable data.');
    const json = JSON.parse(text.slice(start, end + 1));
    if (json.status !== 'ok' || !json.table || !Array.isArray(json.table.rows) || !Array.isArray(json.table.cols)) throw new Error('The Sheet query could not be read.');
    return json.table;
  }
  function parseMeals(table) {
    if (!table) return [];
    const cols = {
      date: column(table, ['Date'], 0), meal: column(table, ['Meal'], 1), time: column(table, ['Time'], 2),
      items: column(table, ['Items', 'Food', 'Foods'], 3), kcal: column(table, ['Calories (est)', 'Calories', 'kcal'], 4),
      protein: column(table, ['Protein (g)', 'Protein'], 5), carbs: column(table, ['Carbs (g)', 'Carbohydrates (g)', 'Carbs'], 6),
      fat: column(table, ['Fat (g)', 'Fat'], 7), photo: column(table, ['Photo'], 8), notes: column(table, ['Notes'], 9)
    };
    return (table.rows || []).flatMap((row, i) => {
      const date = rowDate(row, cols.date);
      if (!date) return [];
      const notes = String(cell(row, cols.notes) || '');
      // An explicit inclusion note means blank add-on macros are already represented in another entry.
      const bundled = /(?:macros?\s+(?:already\s+)?(?:included|counted)|(?:included|counted)\s+in\s+.+?macros?)/i.test(notes);
      return [{ id: `meal-${i}`, date, meal: String(cell(row, cols.meal) || 'Meal'), time: String(cell(row, cols.time) || ''), items: String(cell(row, cols.items) || ''), kcal: number(cell(row, cols.kcal, true)), protein: number(cell(row, cols.protein, true)), carbs: number(cell(row, cols.carbs, true)), fat: number(cell(row, cols.fat, true)), photo: /^yes$/i.test(String(cell(row, cols.photo) || '')), notes, bundled }];
    }).sort((a, b) => a.date.localeCompare(b.date));
  }
  function parseTarget(text, fallback = [DEFAULTS.calorieLow, DEFAULTS.calorieHigh]) {
    const clean = String(text || '').replace(/,/g, '');
    const match = clean.match(/(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)/);
    if (match && +match[1] > 0 && +match[2] >= +match[1]) return [+match[1], +match[2]];
    return fallback.slice();
  }
  function parseDaily(table) {
    if (!table) return [];
    const dateCol = column(table, ['Date'], 0), calCol = column(table, ['Total kcal (est)', 'Total kcal', 'Calories'], 1), targetCol = column(table, ['Calorie target', 'Target'], 2), weightCol = column(table, ['Weight (kg)', 'Weight'], 4), notesCol = column(table, ['Notes'], 5);
    return (table.rows || []).flatMap(row => {
      const date = rowDate(row, dateCol);
      if (!date) return [];
      const weight = number(cell(row, weightCol, true));
      return [{ date, kcal: number(cell(row, calCol, true)), target: String(cell(row, targetCol) || ''), weight: weight > 0 ? weight : null, notes: String(cell(row, notesCol) || '') }];
    }).sort((a, b) => a.date.localeCompare(b.date));
  }
  function mealGroup(meal) {
    if (/breakfast|morning/i.test(meal)) return 'Breakfast';
    if (/lunch|afternoon/i.test(meal)) return 'Lunch';
    if (/dinner|supper/i.test(meal)) return 'Dinner';
    return 'Snacks & drinks';
  }
  function buildDays(meals, daily, settings = DEFAULTS) {
    const summaries = new Map();
    for (const row of daily) {
      const prev = summaries.get(row.date);
      summaries.set(row.date, prev ? { ...prev, ...row, kcal: row.kcal ?? prev.kcal, weight: row.weight ?? prev.weight, target: row.target || prev.target } : row);
    }
    const byDate = new Map();
    for (const meal of meals) { if (!byDate.has(meal.date)) byDate.set(meal.date, []); byDate.get(meal.date).push(meal); }
    const dates = [...new Set([...summaries.keys(), ...byDate.keys()])].sort();
    return dates.map(date => {
      const entries = byDate.get(date) || [], summary = summaries.get(date);
      const knownCals = entries.filter(m => m.kcal != null);
      const mealCalories = knownCals.length ? knownCals.reduce((s, m) => s + m.kcal, 0) : null;
      const allCals = entries.length > 0 && knownCals.length === entries.length;
      const summaryCalories = summary?.kcal ?? null;
      const kcal = allCals ? mealCalories : summaryCalories ?? mealCalories;
      const result = { date, meals: entries, summary, kcal, mealCalories, summaryCalories, observed: entries.length > 0 || summaryCalories != null, calorieSource: allCals ? 'meals' : summaryCalories != null ? 'summary' : 'partial meals', caloriePartial: !allCals && summaryCalories == null && entries.length > 0, summaryMismatch: allCals && summaryCalories != null && Math.abs(summaryCalories - mealCalories) > 1, target: settings.sheetTargets ? parseTarget(summary?.target, [settings.calorieLow, settings.calorieHigh]) : [settings.calorieLow, settings.calorieHigh] };
      for (const key of ['protein', 'carbs', 'fat']) {
        const known = entries.filter(m => m[key] != null);
        result[key] = known.length ? known.reduce((s, m) => s + m[key], 0) : null;
        result[`${key}Partial`] = entries.length === 0 || entries.some(m => m[key] == null && !m.bundled);
      }
      result.macroEnergy = [result.protein, result.carbs, result.fat].every(finite) && !result.proteinPartial && !result.carbsPartial && !result.fatPartial ? result.protein * 4 + result.carbs * 4 + result.fat * 9 : null;
      result.bundledCount = entries.filter(m => m.bundled).length;
      return result;
    });
  }
  function emptyDay(date, settings = DEFAULTS) {
    return { date, meals: [], kcal: null, protein: null, carbs: null, fat: null, observed: false, caloriePartial: false, proteinPartial: true, carbsPartial: true, fatPartial: true, target: [settings.calorieLow, settings.calorieHigh], macroEnergy: null };
  }
  function calorieStatus(day) {
    if (day.kcal == null) return { state: 'empty', delta: null };
    const [low, high] = day.target;
    if (day.kcal > high) return { state: 'above', delta: day.kcal - high };
    if (day.caloriePartial) return { state: 'partial', delta: null };
    if (day.kcal < low) return { state: 'below', delta: low - day.kcal };
    return { state: 'within', delta: high - day.kcal };
  }
  function proteinStatus(day, target) {
    if (day.protein == null) return { state: 'empty', delta: null };
    if (day.protein >= target) return { state: 'met', delta: day.protein - target };
    if (day.proteinPartial) return { state: 'partial', delta: null };
    return { state: 'below', delta: target - day.protein };
  }
  function windowStats(days, end, count, proteinTarget) {
    const dates = rangeDates(end, count);
    const inside = days.filter(d => dates.includes(d.date) && d.observed);
    const calorieDays = inside.filter(d => d.kcal != null && !d.caloriePartial);
    const proteinDays = inside.filter(d => d.protein != null && !d.proteinPartial);
    const mean = (rows, key) => rows.length ? rows.reduce((sum, d) => sum + d[key], 0) / rows.length : null;
    return { dates, inside, logged: inside.length, calorieDays, proteinDays, averageCalories: mean(calorieDays, 'kcal'), averageProtein: mean(proteinDays, 'protein'), inRange: calorieDays.filter(d => calorieStatus(d).state === 'within').length, proteinMet: proteinDays.filter(d => d.protein >= proteinTarget).length };
  }
  function weightStats(daily, end, goal) {
    const byDate = new Map();
    daily.filter(d => d.date <= end && finite(d.weight) && d.weight > 0).forEach(d => byDate.set(d.date, d));
    const points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (!points.length) return { points, latest: null, change: null, distance: null, progress: null };
    const latest = points[points.length - 1], baseline = points[0].weight;
    const distance = Math.abs(latest.weight - goal);
    const initialDistance = Math.abs(baseline - goal);
    return { points, latest, baseline, change: points.length > 1 ? latest.weight - baseline : null, distance, progress: initialDistance ? Math.max(0, Math.min(100, (initialDistance - distance) / initialDistance * 100)) : latest.weight === goal ? 100 : 0 };
  }
  return { DEFAULTS, finite, number, isoDate, today, shiftDate, rangeDates, fmtDate, parseGviz, parseMeals, parseDaily, parseTarget, mealGroup, buildDays, emptyDay, calorieStatus, proteinStatus, windowStats, weightStats };
});
