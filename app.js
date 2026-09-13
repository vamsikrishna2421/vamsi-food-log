/* Nouri: a read-only view of the existing Google Sheet. */
(() => {
  'use strict';
  const N = window.Nutrition;
  const SHEET_ID = '1qLlbE0ehY8bNAJ-ocmxHFhRSFdZ-l9j27B6-zZXU0es';
  const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
  const CACHE_KEY = 'nouri.sheet.v1', SETTINGS_KEY = 'nouri.preferences.v1';
  const $ = id => document.getElementById(id);
  const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const fmt = (value, decimals = 0) => value == null ? '—' : value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const clamp = value => Math.max(0, Math.min(100, value));
  const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  const remove = key => { try { localStorage.removeItem(key); } catch { /* Storage can be unavailable in private contexts. */ } };
  function validSettings(raw) {
    const s = { ...N.DEFAULTS };
    if (!raw || typeof raw !== 'object') return s;
    if (N.finite(raw.calorieLow) && N.finite(raw.calorieHigh) && raw.calorieLow > 0 && raw.calorieHigh >= raw.calorieLow && raw.calorieHigh <= 20000) { s.calorieLow = raw.calorieLow; s.calorieHigh = raw.calorieHigh; }
    if (N.finite(raw.protein) && raw.protein >= 1 && raw.protein <= 1000) s.protein = raw.protein;
    if (N.finite(raw.weight) && raw.weight >= 20 && raw.weight <= 500) s.weight = raw.weight;
    if (typeof raw.sheetTargets === 'boolean') s.sheetTargets = raw.sheetTargets;
    if (typeof raw.proteinReviewed === 'boolean') s.proteinReviewed = raw.proteinReviewed;
    if (['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Asia/Kolkata', 'UTC'].includes(raw.timezone)) s.timezone = raw.timezone;
    return s;
  }
  const state = { settings: validSettings(read(SETTINGS_KEY)), source: {}, meals: [], daily: [], days: [], selected: null, chartEnd: null, range: 7, metric: 'kcal', loading: true, ready: false, autoSelect: true, errors: [], query: '', filter: 'all' };
  const today = () => N.today(state.settings.timezone);
  const selectedDay = () => state.days.find(d => d.date === state.selected) || N.emptyDay(state.selected || today(), state.settings);
  const targetLabel = () => state.settings.proteinReviewed ? 'your target' : 'your provisional target';
  const sourceDate = value => new Date(value).toLocaleString('en-US', { timeZone: state.settings.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  function bindSheetLinks() { document.querySelectorAll('.sheet-link').forEach(a => { a.href = SHEET_URL; }); }
  let toastTimer;
  function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000); }
  function hydrate() {
    state.meals = N.parseMeals(state.source.meals?.table);
    state.daily = N.parseDaily(state.source.daily?.table);
    state.days = N.buildDays(state.meals, state.daily, state.settings);
    if (state.autoSelect) {
      const logged = state.days.filter(d => d.observed && d.date <= today());
      state.selected = logged.some(d => d.date === today()) ? today() : logged.at(-1)?.date || today();
      state.chartEnd = today();
    }
    if (!state.selected || state.selected > today()) state.selected = today();
  }
  function setDate(date, scroll = false) {
    const valid = N.isoDate(date);
    if (!valid || valid > today() || valid < '2000-01-01') return;
    state.selected = valid;
    state.autoSelect = false;
    if (valid < N.rangeDates(state.chartEnd || today(), state.range)[0] || valid > (state.chartEnd || today())) state.chartEnd = valid;
    state.query = ''; state.filter = 'all'; $('mealSearch').value = ''; $('mealFilter').value = 'all';
    const url = new URL(location.href); url.searchParams.set('date', valid);
    try { history.replaceState(null, '', url); } catch { /* Standalone previews may restrict browser history. */ }
    renderAll();
    if (scroll) $('overview').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function energyText(day, past = false) {
    const status = N.calorieStatus(day);
    const atLeast = day.caloriePartial ? 'At least ' : '';
    if (status.state === 'above') return `${atLeast}${fmt(status.delta)} kcal above range`;
    if (status.state === 'within') return 'Within your target range';
    if (status.state === 'partial') return 'Some calorie values are missing';
    if (status.state === 'below') return past ? `${fmt(status.delta)} kcal below range` : `${fmt(status.delta)} kcal to reach your range`;
    return 'No calorie data yet';
  }
  function proteinText(day) {
    const status = N.proteinStatus(day, state.settings.protein);
    if (status.state === 'met') return `Goal met${status.delta ? ` · ${day.proteinPartial ? 'at least ' : ''}${fmt(status.delta)} g above target` : ''}`;
    if (status.state === 'below') return `${fmt(status.delta)} g to your target`;
    if (status.state === 'partial') return 'Some protein values are missing';
    return 'No protein data yet';
  }
  function renderBrief(day) {
    const cal = N.calorieStatus(day), pro = N.proteinStatus(day, state.settings.protein), past = day.date !== today();
    const hasSource = state.source.meals || state.source.daily;
    let title, accent, description;
    if (state.loading && !hasSource) {
      title = 'A clearer picture'; accent = 'starts here.'; description = 'Bringing your food log and your goals together.';
    } else if (!hasSource) {
      title = 'Your log is taking'; accent = 'a moment to connect.'; description = 'We couldn’t read your Google Sheet. Refresh to try again, or open your Sheet directly below.';
    } else if (!day.observed) {
      title = day.date === today() ? 'A fresh page' : 'A little room'; accent = day.date === today() ? 'for today.' : 'to fill in the picture.';
      description = `No food is logged for ${N.fmtDate(day.date, { weekday: 'long' })}. Add a meal to see your calories, protein, and next step come into focus.`;
    } else if (cal.state === 'above' && pro.state === 'met') {
      title = 'Protein goal met.'; accent = 'Calories above range.';
      description = `${day.proteinPartial ? 'At least ' : ''}${fmt(day.protein)} g of protein meets ${targetLabel()}. Your logged ${fmt(day.kcal)} kcal is ${fmt(cal.delta)} above the ${fmt(day.target[1])} upper target.`;
    } else if (cal.state === 'within' && pro.state === 'met') {
      title = 'Calories in range.'; accent = 'Protein goal met.';
      description = `Your logged ${fmt(day.kcal)} kcal sits within your saved range, and ${fmt(day.protein)} g of protein meets ${targetLabel()}. A useful snapshot to build on.`;
    } else if (pro.state === 'below') {
      title = `${fmt(pro.delta)} g of protein`; accent = 'to your chosen target.';
      description = `${fmt(day.protein)} g is logged against ${targetLabel()} of ${fmt(state.settings.protein)} g. ${energyText(day, past)}. Explore a meal in the lab to see how it changes the picture.`;
    } else if (cal.state === 'above') {
      title = 'A day to understand,'; accent = 'one meal at a time.';
      description = `You logged ${fmt(day.kcal)} kcal, ${fmt(cal.delta)} above your upper target. ${day.protein == null || day.proteinPartial ? 'Protein values are incomplete; check the meal details before drawing a conclusion.' : proteinText(day) + '.'}`;
    } else if (pro.state === 'met') {
      title = 'Protein goal met.'; accent = 'Keep the picture complete.';
      description = `${fmt(day.protein)} g of protein meets ${targetLabel()}. ${energyText(day, past)}. These totals reflect the food entered in your log.`;
    } else {
      title = 'Every entry brings'; accent = 'a little more clarity.';
      description = `${day.kcal != null ? `${fmt(day.kcal)} kcal is recorded. ` : ''}Some nutrition values are missing. Complete those entries to make goal comparisons more useful.`;
    }
    $('briefHeading').innerHTML = `${esc(title)}<br><span>${esc(accent)}</span>`;
    $('briefText').textContent = description;
    $('briefDate').textContent = `${N.fmtDate(day.date).toUpperCase()} · ${past ? 'DAY IN REVIEW' : 'IN PROGRESS'}`;
    $('briefMeta').textContent = day.observed ? `${day.meals.length} ${day.meals.length === 1 ? 'entry' : 'entries'} · Estimated nutrition` : 'Your Google Sheet, brought to life';
    const midpoint = (day.target[0] + day.target[1]) / 2;
    const cpct = day.kcal == null ? 0 : day.kcal / midpoint * 100, ppct = day.protein == null ? 0 : day.protein / state.settings.protein * 100;
    const outer = 2 * Math.PI * 80, inner = 2 * Math.PI * 64;
    $('briefVisual').innerHTML = `<svg class="goal-rings" viewBox="0 0 200 200" role="img" aria-label="${esc(`Calories: ${day.kcal == null ? 'not recorded' : `${fmt(cpct)} percent of the ${fmt(midpoint)} kcal target midpoint`}. Protein: ${day.protein == null ? 'not recorded' : `${fmt(ppct)} percent of the ${fmt(state.settings.protein)} g ${state.settings.proteinReviewed ? '' : 'provisional '}target`}. Rings fill at 100 percent; amounts above target remain visible in the labels.`)}"><circle class="ring-track" cx="100" cy="100" r="80"/><circle class="ring-track" cx="100" cy="100" r="64" style="stroke-width:7"/><circle class="ring-energy" cx="100" cy="100" r="80" stroke-dasharray="${outer * clamp(cpct) / 100} ${outer}"${cpct === 0 ? ' style="opacity:0"' : ''}/><circle class="ring-protein" cx="100" cy="100" r="64" stroke-dasharray="${inner * clamp(ppct) / 100} ${inner}"${ppct === 0 ? ' style="opacity:0"' : ''}/><text x="100" y="83" text-anchor="middle" class="ring-caption">CALORIES</text><text x="100" y="116" text-anchor="middle" class="ring-number">${fmt(day.kcal)}</text><text x="100" y="134" text-anchor="middle" class="ring-unit">kcal logged</text></svg><div class="ring-legend"><span><i></i>Energy ${day.kcal == null ? '—' : fmt(cpct) + '%'} of midpoint</span><span><i></i>Protein ${day.protein == null ? '—' : fmt(ppct) + '%'} of target</span></div>`;
  }
  function renderMetrics(day) {
    const cal = N.calorieStatus(day), pro = N.proteinStatus(day, state.settings.protein);
    const midpoint = (day.target[0] + day.target[1]) / 2;
    const carbsPct = day.macroEnergy > 0 ? day.carbs * 4 / day.macroEnergy * 100 : null;
    const fatPct = day.macroEnergy > 0 ? day.fat * 9 / day.macroEnergy * 100 : null;
    const nutrientShare = (value, partial) => partial ? 'Some values are missing' : value == null ? 'No macro energy split yet' : `${fmt(value)}% of logged macro energy`;
    const metric = ({ cls, name, ico, value, unit, target, note, pct, tag, status }) => `<article class="metric ${cls}"><div class="metric-top">${icon(ico)}<h3 style="font:inherit;letter-spacing:0">${name}</h3>${tag ? `<span class="tag">${tag}</span>` : ''}</div><div class="metric-number">${fmt(value)}<span>${unit}</span></div><div class="metric-target">${target}</div><div class="metric-bar" aria-hidden="true"><span style="width:${clamp(pct || 0)}%"></span></div><div class="metric-note ${status || ''}">${status === 'good' ? icon('check') : ''}${esc(note)}</div></article>`;
    $('metricsGrid').innerHTML = metric({ cls: 'energy', name: 'Calories', ico: 'fire', value: day.kcal, unit: 'kcal', target: `Target ${fmt(day.target[0])}–${fmt(day.target[1])} kcal${day.caloriePartial ? ' · partial log' : ''}`, note: energyText(day, day.date !== today()), pct: day.kcal / midpoint * 100, status: cal.state === 'above' ? 'warn' : cal.state === 'within' ? 'good' : '' }) + metric({ cls: 'protein', name: 'Protein', ico: 'protein', value: day.protein, unit: 'g', target: `<button data-action="settings">${state.settings.proteinReviewed ? 'Your' : 'Provisional'} target ${fmt(state.settings.protein)} g · edit</button>`, note: proteinText(day), pct: day.protein / state.settings.protein * 100, status: pro.state === 'met' ? 'good' : '' }) + metric({ cls: 'carbs', name: 'Carbs', ico: 'grain', value: day.carbs, unit: 'g', target: 'Flexible · no target set', note: nutrientShare(carbsPct, day.carbs != null && day.carbsPartial), pct: carbsPct, tag: 'FLEXIBLE' }) + metric({ cls: 'fat', name: 'Fats', ico: 'drop', value: day.fat, unit: 'g', target: 'Flexible · no target set', note: nutrientShare(fatPct, day.fat != null && day.fatPartial), pct: fatPct, tag: 'FLEXIBLE' });
  }
  function renderChart() {
    const end = state.chartEnd || today(), stats = N.windowStats(state.days, end, state.range, state.settings.protein);
    const protein = state.metric === 'protein', metric = state.metric;
    const mean = protein ? stats.averageProtein : stats.averageCalories;
    const count = protein ? stats.proteinDays.length : stats.calorieDays.length;
    $('chartStat').innerHTML = `${fmt(mean)}<span>${protein ? 'g protein' : 'kcal'} / logged day</span><small>${count ? `Average across ${count} day${count === 1 ? '' : 's'} with ${protein ? 'protein' : 'calorie'} values` : 'Your first entry will start the picture'}</small>`;
    const points = stats.dates.map(date => state.days.find(d => d.date === date) || N.emptyDay(date, state.settings));
    const width = Math.max(260, Math.round($('trendChart').getBoundingClientRect().width || 560)), height = 184;
    const left = 31, right = 5, top = 14, bottom = 146, plot = width - left - right, col = plot / points.length;
    const maximum = Math.max(protein ? state.settings.protein : state.settings.calorieHigh, ...points.flatMap(d => [d[metric] || 0, protein ? state.settings.protein : d.target[1]]));
    const tick = protein ? Math.max(25, Math.ceil(maximum * 1.18 / 4 / 25) * 25) : Math.max(250, Math.ceil(maximum * 1.18 / 4 / 250) * 250);
    const max = tick * 4, y = value => bottom - value / max * (bottom - top);
    let svg = `<svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${protein ? 'Protein' : 'Calorie'} intake for ${state.range} calendar days ending ${N.fmtDate(end)}. Select a day to inspect its meals. Full values are in View chart data below.">`;
    for (let i = 0; i <= 4; i++) { const value = tick * i; svg += `<line class="gridline" x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}"/><text x="${left - 8}" y="${y(value) + 3}" text-anchor="end">${!protein && value >= 1000 ? (value / 1000).toFixed(value % 1000 ? 1 : 0) + 'k' : value}</text>`; }
    if (protein) svg += `<line class="target-line" x1="${left}" x2="${width - right}" y1="${y(state.settings.protein)}" y2="${y(state.settings.protein)}"/>`;
    else points.forEach((d, i) => { const x = left + i * col; svg += `<rect class="target-band" x="${x}" y="${y(d.target[1])}" width="${col + .2}" height="${Math.max(1, y(d.target[0]) - y(d.target[1]))}"/><path class="target-line" d="M${x},${y(d.target[0])}h${col}M${x},${y(d.target[1])}h${col}"/>`; });
    points.forEach((d, i) => {
      const center = left + col * (i + .5), barWidth = Math.max(3, Math.min(31, col * .48)), value = d[metric], selected = d.date === state.selected;
      const isAbove = !protein && value != null && value > d.target[1];
      const partial = protein ? d.proteinPartial : d.caloriePartial;
      const description = `${N.fmtDate(d.date)}: ${value == null ? 'No data' : `${fmt(value)} ${protein ? 'g protein' : 'kcal'}${partial ? ', some values missing' : ''}`}${selected ? ', selected' : ''}`;
      svg += `<g class="bar-group" tabindex="0" role="button" data-select-date="${d.date}" aria-label="${esc(description)}"><title>${esc(description)}</title><rect class="bar-hit" x="${center - col / 2}" y="2" width="${col}" height="177"/>`;
      if (value != null) {
        svg += `<rect class="bar ${isAbove ? 'above' : ''}" x="${center - barWidth / 2}" y="${value ? y(value) : bottom - 2}" width="${barWidth}" height="${Math.max(2, bottom - y(value))}" rx="${Math.min(4, barWidth / 3)}"${partial ? ' opacity=".5"' : ''}/>`;
        if (points.length <= 7 || selected) svg += `<text class="bar-value" x="${center}" y="${y(value) - 8}" text-anchor="middle">${fmt(value)}</text>`;
      } else svg += `<circle class="empty-point" fill="white" cx="${center}" cy="${bottom - 2}" r="2"/>`;
      const interval = points.length > 14 ? 5 : points.length > 7 ? 2 : 1;
      if (i % interval === 0 || i === points.length - 1) svg += `<text x="${center}" y="${bottom + 19}" class="${selected ? 'selected-label' : ''}" text-anchor="middle">${points.length <= 7 ? N.fmtDate(d.date, { month: undefined, day: undefined, weekday: 'short' }) : N.fmtDate(d.date, { month: undefined })}</text>`;
      if (selected) svg += `<circle class="selected-marker" cx="${center}" cy="${bottom + 29}" r="2"/>`;
      svg += '</g>';
    });
    svg += '</svg>';
    $('trendChart').innerHTML = svg;
    $('targetLegend').textContent = protein ? `${fmt(state.settings.protein)} g ${state.settings.proteinReviewed ? 'target' : 'provisional target'}` : 'Your target range';
    $('chartCaption').textContent = `${N.fmtDate(stats.dates[0])}–${N.fmtDate(end)} · Blank days have no log. Totals may reflect incomplete days.`;
    const stat = (n, of, label) => `<div class="consistency-item"><strong>${of ? n : '—'} <span>/ ${of}</span></strong><p>${label}</p></div>`;
    $('consistencyGrid').innerHTML = stat(stats.logged, state.range, 'Days with a food log') + stat(stats.proteinMet, stats.proteinDays.length, 'Protein targets met') + stat(stats.inRange, stats.calorieDays.length, 'Days in calorie range');
    $('chartTable').innerHTML = `<table><caption class="sr-only">Nutrition log and targets by date</caption><thead><tr><th scope="col">Date</th><th scope="col">Calories</th><th scope="col">Calorie target</th><th scope="col">Protein</th></tr></thead><tbody>${points.map(d => `<tr><th scope="row">${N.fmtDate(d.date)}</th><td>${fmt(d.kcal)}${d.caloriePartial ? ' (partial)' : ''}</td><td>${fmt(d.target[0])}–${fmt(d.target[1])}</td><td>${fmt(d.protein)}${d.protein != null ? ' g' : ''}${d.protein != null && d.proteinPartial ? ' (partial)' : ''}</td></tr>`).join('')}</tbody></table>`;
    document.querySelectorAll('[data-range]').forEach(b => { const active = +b.dataset.range === state.range; b.classList.toggle('selected', active); b.setAttribute('aria-pressed', active); });
    document.querySelectorAll('[data-metric]').forEach(b => { const active = b.dataset.metric === metric; b.classList.toggle('selected', active); b.setAttribute('aria-pressed', active); });
  }
  function groupedMeals(day) {
    return ['Breakfast', 'Lunch', 'Dinner', 'Snacks & drinks'].map(name => {
      const entries = day.meals.filter(m => N.mealGroup(m.meal) === name), withCalories = entries.filter(m => m.kcal != null);
      return { name, entries, kcal: withCalories.length ? withCalories.reduce((s, m) => s + m.kcal, 0) : null, partial: withCalories.length !== entries.length };
    }).filter(g => g.entries.length);
  }
  function renderInsights(day) {
    const out = [], cal = N.calorieStatus(day), pro = N.proteinStatus(day, state.settings.protein);
    if (pro.state === 'met') out.push({ title: 'Protein is covered in this log.', body: `You recorded <strong>${fmt(day.protein)} g</strong>, reaching ${targetLabel()} of ${fmt(state.settings.protein)} g. The amount above target is shown as extra, not as a failed goal.`, link: 'Review your protein target', action: 'settings' });
    else if (pro.state === 'below') out.push({ title: 'Protein has the clearest gap.', body: `The logged total is <strong>${fmt(pro.delta)} g</strong> short of ${targetLabel()}. Preview a meal in the lab to see how it contributes.`, link: 'Try the meal lab', href: '#planner' });
    else out.push({ title: day.observed ? 'A few values need filling in.' : 'Your next entry starts the story.', body: day.observed ? 'Some protein values aren’t recorded. Add the missing values to make the target comparison useful.' : 'A food entry with a portion, calories and protein turns into a useful daily snapshot.', link: 'Open your food log', href: SHEET_URL });
    const groups = groupedMeals(day), largest = groups.filter(g => g.kcal != null).sort((a, b) => b.kcal - a.kcal)[0];
    const denominator = day.mealCalories;
    if (largest && denominator > 0 && !day.caloriePartial) out.push({ title: `${largest.name} led your calorie total.`, body: `<strong>${fmt(largest.kcal)} kcal · ${fmt(largest.kcal / denominator * 100)}%</strong> of the calories recorded in meals for ${N.fmtDate(day.date)}. ${largest.entries.length > 1 ? `${largest.entries.length} separate entries contribute to that total.` : 'Open the entry to see its portion and notes.'}`, link: 'Explore the meal', filter: largest.name });
    else if (cal.state === 'above') out.push({ title: 'The comparison is with your goal.', body: `<strong>${fmt(cal.delta)} kcal</strong> above your upper target. This compares recorded intake with your saved range; it doesn’t estimate energy burned.`, link: 'See the calculation notes', action: 'about' });
    else out.push({ title: 'Your targets can evolve with you.', body: `Your calorie fallback is <strong>${fmt(state.settings.calorieLow)}–${fmt(state.settings.calorieHigh)} kcal</strong>. Protein is ${state.settings.proteinReviewed ? 'set to' : 'provisionally set to'} ${fmt(state.settings.protein)} g. You can review both at any time.`, link: 'Make the targets yours', action: 'settings' });
    const stats = N.windowStats(state.days, state.chartEnd || today(), state.range, state.settings.protein);
    if (stats.logged < 7) out.push({ title: 'You’re building a baseline.', body: `<strong>${stats.logged} of ${state.range} days</strong> have food logged in this window. More complete days will make your averages and patterns more useful.`, link: 'About your data', action: 'about' });
    else out.push({ title: 'Consistency, made visible.', body: `<strong>${stats.proteinMet} of ${stats.proteinDays.length}</strong> days with protein values reached your target. ${stats.inRange} of ${stats.calorieDays.length} days with calorie values were in range.`, link: 'Explore the rhythm', href: '#patterns' });
    $('insightsBody').innerHTML = out.map((o, i) => `<div class="insight-item"><span class="insight-index">0${i + 1}</span><div><h3>${esc(o.title)}</h3><p>${o.body}</p>${o.action ? `<button class="text-button" data-action="${o.action}">${esc(o.link)} ${icon('arrow')}</button>` : o.filter ? `<button class="text-button" data-filter-meal="${esc(o.filter)}">${esc(o.link)} ${icon('arrow')}</button>` : `<a href="${esc(o.href)}"${o.href.startsWith('https:') ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(o.link)} ${icon('arrow')}</a>`}</div></div>`).join('');
  }
  function renderMeals(day) {
    $('journalDate').textContent = `${N.fmtDate(day.date, { weekday: 'long' }).toUpperCase()} · YOUR FOOD, UP CLOSE`;
    $('mealCount').textContent = `${day.meals.length} ${day.meals.length === 1 ? 'entry' : 'entries'}`;
    const query = state.query.trim().toLowerCase();
    const meals = day.meals.filter(m => (state.filter === 'all' || N.mealGroup(m.meal) === state.filter) && (!query || `${m.items} ${m.meal} ${m.notes}`.toLowerCase().includes(query)));
    let warning = '';
    if (day.summaryMismatch) warning = `<div class="notice-inline">Meal entries total ${fmt(day.mealCalories)} kcal; the daily summary says ${fmt(day.summaryCalories)}. Showing meal entries. Review the summary in your Sheet.</div>`;
    else if (day.calorieSource === 'summary' && day.meals.length) warning = '<div class="notice-inline">Some meal calorie values are missing. The daily snapshot uses the total from your daily summary.</div>';
    if (!meals.length) {
      $('mealsBody').innerHTML = warning + `<div class="empty-state">${icon('bowl')}<strong>${day.meals.length ? 'No matching meals.' : 'A place for your next meal.'}</strong>${day.meals.length ? 'Try another search or choose All meals.' : `No meal entries for ${N.fmtDate(day.date)}.${day.observed ? ' A daily total may still be available in the summary.' : ''}`}<br>${day.meals.length ? '<button class="text-button" data-action="clear-filters">Clear filters</button>' : `<a href="${SHEET_URL}" target="_blank" rel="noopener noreferrer">Log a meal in your Sheet ${icon('arrow')}</a>`}</div>`;
      return;
    }
    $('mealsBody').innerHTML = warning + meals.map(m => {
      const group = N.mealGroup(m.meal), ico = group === 'Breakfast' ? 'sun' : group === 'Lunch' ? 'bowl' : group === 'Dinner' ? 'moon' : 'cup';
      const cls = group === 'Dinner' ? 'dinner' : group === 'Breakfast' ? 'breakfast' : group === 'Snacks & drinks' ? 'snacks' : '';
      const missing = ['protein', 'carbs', 'fat'].filter(key => m[key] == null);
      const macro = (key, label) => m[key] == null ? m.bundled ? '' : `<span>${label} —</span>` : `<span><b>${label}</b> ${fmt(m[key])} g</span>`;
      return `<details class="meal-entry"><summary><span class="meal-icon ${cls}">${icon(ico)}</span><div class="meal-copy"><div class="meal-title"><strong>${esc(m.meal)}</strong>${m.time ? `<time>${esc(m.time)}</time>` : ''}</div><p>${esc(m.items || 'Food details not entered')}</p><div class="meal-macros">${macro('protein', 'P')}${macro('carbs', 'C')}${macro('fat', 'F')}${m.bundled && missing.length ? '<span class="included">Add-on macros included in another entry</span>' : ''}</div></div><div class="meal-calories">${fmt(m.kcal)}<span>kcal</span>${icon('chevron')}</div></summary><div class="meal-extra"><p><strong>Log notes</strong><br>${esc(m.notes || 'No additional notes for this meal.')}</p>${m.photo ? '<p>A photo was referenced in your Sheet. No photo file is linked.</p>' : ''}${missing.length && !m.bundled ? `<p>Missing values: ${esc(missing.join(', '))}. Blank cells are not treated as zero.</p>` : ''}<p>Estimates from your food log. P = protein, C = carbohydrates, F = fat.</p></div></details>`;
    }).join('');
  }
  function renderBreakdown(day) {
    const groups = groupedMeals(day), total = day.mealCalories;
    if (!groups.length || total == null) { $('mealBreakdown').innerHTML = `<div class="empty-state">${icon('bowl')}<strong>Meals make the picture.</strong>Calories by meal appear when you add food with calorie values.</div>`; return; }
    const colors = { Breakfast: '#d9c297', Lunch: '#adc39d', Dinner: '#6f8d64', 'Snacks & drinks': '#d2dbbf' };
    $('mealBreakdown').innerHTML = `<div class="breakdown-total">${fmt(total)}<span>kcal in meal entries${groups.some(g => g.partial) ? ' · partial' : ''}</span></div><div class="meal-stack" aria-hidden="true">${groups.filter(g => g.kcal > 0).map(g => `<span style="width:${g.kcal / total * 100}%;background:${colors[g.name]}"></span>`).join('')}</div>${groups.map(g => `<button class="breakdown-row" data-filter-meal="${esc(g.name)}" aria-label="Show ${esc(g.name)} entries, ${fmt(g.kcal)} kcal"><div class="breakdown-row-top"><i style="background:${colors[g.name]}"></i>${esc(g.name)}<strong>${fmt(g.kcal)} kcal</strong></div><div class="breakdown-row-bottom"><span>${g.entries.length} ${g.entries.length === 1 ? 'entry' : 'entries'}${g.partial ? ' · incomplete values' : ''}</span><span>${g.kcal != null && total > 0 ? fmt(g.kcal / total * 100) + '%' : '—'}</span></div></button>`).join('')}<p class="breakdown-note">Tap any meal group to explore its entries.${day.bundledCount ? ` ${day.bundledCount} add-on${day.bundledCount > 1 ? 's have' : ' has'} macros included in another meal.` : ' Percentages use calories from meal entries.'}</p>`;
  }
  function populatePresets() {
    const selected = $('plannerPreset').value;
    const available = state.meals.filter(m => m.date <= today() && m.kcal != null).slice(-50).reverse();
    $('plannerPreset').innerHTML = '<option value="custom">Enter your own estimate</option>' + available.map(m => `<option value="${m.id}">${esc(m.items.length > 68 ? m.items.slice(0, 65) + '…' : m.items || m.meal)} · ${fmt(m.kcal)} kcal</option>`).join('');
    if ([...$('plannerPreset').options].some(o => o.value === selected)) $('plannerPreset').value = selected;
  }
  function renderPlanner() {
    const day = selectedDay(), fresh = $('plannerBase').value === 'fresh';
    $('plannerBase').options[0].textContent = `${N.fmtDate(day.date)} · selected log`;
    const added = N.number($('planCalories').value), protein = N.number($('planProtein').value);
    if (added == null || added > 10000 || (protein != null && protein > 1000)) { $('plannerResult').innerHTML = '<p class="form-error">Enter a calorie estimate from 0 to 10,000 and protein from 0 to 1,000 g, or leave protein blank if unknown.</p>'; return; }
    const baseKcal = fresh ? 0 : day.kcal, baseProtein = fresh ? 0 : day.protein;
    const projectedKcal = baseKcal == null ? null : baseKcal + added;
    const projectedProtein = baseProtein == null || protein == null ? null : baseProtein + protein;
    const target = fresh ? (state.days.find(d => d.date === today())?.target || [state.settings.calorieLow, state.settings.calorieHigh]) : day.target;
    const projected = { ...day, kcal: projectedKcal, protein: projectedProtein, target, caloriePartial: fresh ? false : day.caloriePartial, proteinPartial: fresh ? false : day.proteinPartial };
    const cs = N.calorieStatus(projected);
    $('plannerResult').innerHTML = `<div class="tiny-label">YOUR WHAT-IF TOTAL · ${fresh ? 'A FRESH DAY' : N.fmtDate(day.date).toUpperCase()}</div><div class="planner-projections"><div class="projection"><strong>${fmt(projectedKcal)}<span>kcal</span></strong><p class="${cs.state === 'above' ? 'warn' : ''}">${esc(projectedKcal == null ? 'Add a baseline log or start a fresh day' : energyText(projected))}</p></div><div class="projection"><strong>${fmt(projectedProtein)}<span>g protein</span></strong><p>${esc(projectedProtein == null ? 'A protein estimate is needed' : proteinText(projected))}</p></div></div>`;
  }
  function renderWeight() {
    const stats = N.weightStats(state.daily, state.selected, state.settings.weight), goal = state.settings.weight;
    // The sidebar is always current. The main weight card respects the snapshot date.
    const current = N.weightStats(state.daily, today(), goal);
    $('sideGoal').textContent = fmt(goal);
    $('sideProgress').style.width = `${current.progress || 0}%`;
    $('sideWeight').textContent = current.latest ? `${fmt(current.latest.weight, 1)} kg latest · ${fmt(current.distance, 1)} kg from goal` : 'Your progress starts here.';
    if (!stats.latest) { $('weightBody').innerHTML = `<div class="empty-state">${icon('scale')}<strong>Your starting point belongs here.</strong>No weigh-ins recorded on or before ${N.fmtDate(state.selected)}. Add your weight in the Daily summary tab.</div>`; return; }
    const latest = stats.latest, points = stats.points;
    const w = 430, h = 126, left = 18, right = 414, top = 20, bottom = 99;
    const values = points.map(p => p.weight), min = Math.min(...values) - .7, max = Math.max(...values) + .7;
    const y = v => bottom - (v - min) / (max - min) * (bottom - top);
    const firstT = new Date(points[0].date).getTime(), lastT = new Date(latest.date).getTime();
    const x = p => points.length === 1 ? 70 : left + (new Date(p.date).getTime() - firstT) / Math.max(1, lastT - firstT) * (right - left);
    let chart = `<svg class="weight-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(points.length === 1 ? `One weigh-in: ${fmt(latest.weight, 1)} kg on ${N.fmtDate(latest.date)}. A trend requires more observations.` : `Weight readings from ${N.fmtDate(points[0].date)} to ${N.fmtDate(latest.date)}: ${points.map(p => `${N.fmtDate(p.date)} ${fmt(p.weight, 1)} kg`).join('; ')}`)}">`;
    [top + 12, 65, bottom].forEach(line => { chart += `<line class="gridline" x1="${left}" x2="${right}" y1="${line}" y2="${line}"/>`; });
    if (points.length > 1) chart += `<path class="line" d="${points.map((p, i) => `${i ? 'L' : 'M'}${x(p)},${y(p.weight)}`).join(' ')}"/>`;
    points.forEach(p => { chart += `<circle class="point" cx="${x(p)}" cy="${y(p.weight)}" r="5"><title>${N.fmtDate(p.date)}: ${fmt(p.weight, 1)} kg</title></circle>`; });
    if (points.length === 1) chart += `<text class="one-label" x="91" y="${y(latest.weight) + 3}">Your first point is in.</text><text x="70" y="118" text-anchor="middle">${N.fmtDate(latest.date)}</text>`;
    else chart += `<text x="${left}" y="118">${N.fmtDate(points[0].date)}</text><text x="${right}" y="118" text-anchor="end">${N.fmtDate(latest.date)}</text>`;
    chart += '</svg>';
    $('weightBody').innerHTML = `<div class="weight-main"><div><div class="weight-number">${fmt(latest.weight, 1)}<span>kg</span></div><div class="weight-asof">Latest as of ${N.fmtDate(latest.date, { year: 'numeric' })}</div></div><div class="weight-distance"><strong>${fmt(stats.distance, 1)} kg</strong><span>${latest.weight === goal ? 'at your chosen goal' : 'from your chosen goal'}</span></div></div>${chart}<div class="weight-baseline"><span>First logged <b>${fmt(stats.baseline, 1)} kg</b></span><span>Your goal <b>${fmt(goal)} kg</b></span></div><p class="weight-annotation">${points.length === 1 ? 'One weigh-in sets your baseline. More observations will reveal the direction over time.' : `${fmt(Math.abs(stats.change), 1)} kg ${stats.change > 0 ? 'up' : stats.change < 0 ? 'down' : 'change'} since your first logged weight, across ${points.length} weigh-ins. Individual readings can fluctuate.`}</p>`;
  }
  function renderAll() {
    const day = selectedDay();
    $('datePicker').value = day.date; $('datePicker').max = today(); $('datePicker').min = '2000-01-01';
    $('nextDay').disabled = day.date >= today(); $('prevDay').disabled = day.date <= '2000-01-01';
    const latest = state.days.filter(d => d.observed && d.date <= today()).at(-1)?.date;
    $('snapshotLabel').textContent = state.loading && !state.ready ? 'Connecting' : day.date === today() ? 'Today' : day.date === latest ? 'Latest logged day' : 'Day in review';
    renderBrief(day); renderMetrics(day); renderChart(); renderInsights(day); renderMeals(day); renderBreakdown(day); renderPlanner(); renderWeight(); bindSheetLinks();
  }
  function updateConnection() {
    const keys = ['meals', 'daily'], available = keys.filter(k => state.source[k]), fresh = keys.filter(k => state.source[k]?.fresh);
    const pending = state.loading;
    let text, warning = false, banner = '';
    if (pending) text = available.length ? 'Refreshing your snapshot' : 'Connecting to your Sheet';
    else if (fresh.length === 2) text = 'Synced just now';
    else {
      warning = true;
      text = available.length ? fresh.length ? 'Partly refreshed' : 'Saved snapshot' : 'Connection unavailable';
      const saved = available.filter(k => !state.source[k].fresh).map(k => `${k === 'meals' ? 'meals' : 'daily summary'} saved ${sourceDate(state.source[k].fetchedAt)}`);
      banner = fresh.length ? `Some data refreshed. ${saved.length ? `Using ${saved.join(' and ')}.` : 'The other Sheet tab is unavailable.'}` : available.length ? `Showing ${saved.join(' and ')}. The latest refresh didn’t connect.` : 'Your food log couldn’t be loaded. Check your connection and that the Sheet is still shared for viewing.';
    }
    $('syncStatus').innerHTML = `<span class="sync-dot ${warning ? 'warning' : pending ? 'loading-dot' : ''}"></span>${esc(text)}`;
    $('syncStatus').title = available.map(k => `${k === 'meals' ? 'Meals' : 'Daily summary'}: ${sourceDate(state.source[k].fetchedAt)}${state.source[k].fresh ? '' : ' (saved)'}`).join('\n');
    $('connectionBanner').hidden = !banner;
    $('connectionBanner').innerHTML = banner ? `${esc(banner)} <button data-action="refresh">Try again</button>` : '';
    $('refreshBtn').classList.toggle('spinning', pending); $('refreshBtn').disabled = pending;
  }
  async function fetchTable(name) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 18000);
    try {
      const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&headers=1&sheet=${encodeURIComponent(name)}`;
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`Sheet returned ${response.status}`);
      return N.parseGviz(await response.text());
    } finally { clearTimeout(timer); }
  }
  async function loadAll() {
    if (loadAll.running) return;
    loadAll.running = true; state.loading = true;
    Object.values(state.source).forEach(s => { s.fresh = false; }); updateConnection();
    try {
      const results = await Promise.allSettled([fetchTable('Meals'), fetchTable('Daily summary')]);
      const keys = ['meals', 'daily'];
      state.errors = [];
      results.forEach((r, i) => { if (r.status === 'fulfilled') state.source[keys[i]] = { table: r.value, fetchedAt: new Date().toISOString(), fresh: true }; else state.errors.push(keys[i]); });
      state.ready = true; state.loading = false; hydrate(); populatePresets(); renderAll(); updateConnection();
      if (Object.keys(state.source).length) write(CACHE_KEY, { version: 1, source: state.source });
    } catch (error) {
      state.loading = false; state.ready = true; state.errors = ['render'];
      $('connectionBanner').hidden = false; $('connectionBanner').textContent = 'The snapshot could not be updated. Refresh to try again.';
      $('syncStatus').innerHTML = '<span class="sync-dot warning"></span>Update unavailable';
      console.error('Dashboard update failed:', error);
    } finally { loadAll.running = false; state.loading = false; $('refreshBtn').classList.remove('spinning'); $('refreshBtn').disabled = false; }
  }
  function openSettings() {
    const s = state.settings;
    $('settingLow').value = s.calorieLow; $('settingHigh').value = s.calorieHigh; $('settingProtein').value = s.protein; $('settingWeight').value = s.weight; $('settingSheetTargets').checked = s.sheetTargets; $('settingReviewed').checked = s.proteinReviewed; $('settingTimezone').value = s.timezone; $('settingsError').textContent = '';
    $('settingsDialog').showModal();
  }
  $('settingsForm').addEventListener('submit', event => {
    event.preventDefault();
    const raw = { calorieLow: +$('settingLow').value, calorieHigh: +$('settingHigh').value, protein: +$('settingProtein').value, weight: +$('settingWeight').value, sheetTargets: $('settingSheetTargets').checked, proteinReviewed: $('settingReviewed').checked, timezone: $('settingTimezone').value };
    if (!$('settingsForm').checkValidity() || raw.calorieHigh < raw.calorieLow) { $('settingsError').textContent = 'The upper calorie target must be at least the lower target. Check the other values, too.'; return; }
    state.settings = validSettings(raw); const saved = write(SETTINGS_KEY, state.settings); hydrate(); renderAll(); updateConnection(); $('settingsDialog').close();
    toast(saved ? 'Your preferences are saved in this browser.' : 'Preferences applied for this visit. Browser storage is unavailable.');
  });
  $('resetSettings').addEventListener('click', () => {
    $('settingLow').value = N.DEFAULTS.calorieLow; $('settingHigh').value = N.DEFAULTS.calorieHigh; $('settingProtein').value = N.DEFAULTS.protein; $('settingWeight').value = N.DEFAULTS.weight; $('settingSheetTargets').checked = true; $('settingReviewed').checked = false; $('settingTimezone').value = N.DEFAULTS.timezone; $('settingsError').textContent = '';
  });
  document.addEventListener('click', event => {
    const b = event.target.closest('[data-action],[data-close],[data-range],[data-metric],[data-select-date],[data-filter-meal]');
    if (!b) return;
    if (b.dataset.close) { $(b.dataset.close).close(); return; }
    if (b.dataset.action === 'settings') openSettings();
    if (b.dataset.action === 'about') $('aboutDialog').showModal();
    if (b.dataset.action === 'refresh') loadAll();
    if (b.dataset.action === 'clear-filters') { state.query = ''; state.filter = 'all'; $('mealSearch').value = ''; $('mealFilter').value = 'all'; renderMeals(selectedDay()); }
    if (b.dataset.range) { state.range = +b.dataset.range; renderChart(); renderInsights(selectedDay()); }
    if (b.dataset.metric) { state.metric = b.dataset.metric; renderChart(); }
    if (b.dataset.selectDate) setDate(b.dataset.selectDate);
    if (b.dataset.filterMeal) { state.filter = b.dataset.filterMeal; state.query = ''; $('mealFilter').value = state.filter; $('mealSearch').value = ''; renderMeals(selectedDay()); $('journal').scrollIntoView({ behavior: 'smooth' }); }
  });
  document.addEventListener('keydown', event => {
    const target = event.target.closest('[data-select-date]');
    if (target && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); const date = target.dataset.selectDate; setDate(date); document.querySelector(`[data-select-date="${date}"]`)?.focus(); }
  });
  $('refreshBtn').addEventListener('click', loadAll);
  $('prevDay').addEventListener('click', () => setDate(N.shiftDate(state.selected, -1)));
  $('nextDay').addEventListener('click', () => setDate(N.shiftDate(state.selected, 1)));
  $('datePicker').addEventListener('change', () => { if (N.isoDate($('datePicker').value)) setDate($('datePicker').value); else $('datePicker').value = state.selected; });
  $('todayBtn').addEventListener('click', () => { state.chartEnd = today(); setDate(today()); });
  $('mealSearch').addEventListener('input', event => { state.query = event.target.value; renderMeals(selectedDay()); });
  $('mealFilter').addEventListener('change', event => { state.filter = event.target.value; renderMeals(selectedDay()); });
  $('plannerBase').addEventListener('change', renderPlanner);
  ['planCalories', 'planProtein'].forEach(id => $(id).addEventListener('input', () => { $('plannerPreset').value = 'custom'; renderPlanner(); }));
  $('plannerPreset').addEventListener('change', event => {
    const meal = state.meals.find(m => m.id === event.target.value);
    if (meal) { $('planCalories').value = meal.kcal ?? ''; $('planProtein').value = meal.protein ?? ''; }
    renderPlanner();
  });
  $('clearCache').addEventListener('click', () => { remove(CACHE_KEY); toast('Saved data snapshot cleared. Your preferences are unchanged.'); });
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
  const navLinks = [...document.querySelectorAll('.main-nav a')];
  const navNames = { overview: 'Overview', patterns: 'Patterns & insights', journal: 'Food journal', planner: 'Meal lab', progress: 'Weight journey' };
  function setNav(id) { navLinks.forEach(a => { const active = a.hash === '#' + id; a.classList.toggle('active', active); if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }); $('breadcrumbPage').textContent = navNames[id] || 'Overview'; }
  navLinks.forEach(a => a.addEventListener('click', () => setNav(a.hash.slice(1))));
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => { const top = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (top) setNav(top.target.id); }, { rootMargin: '-90px 0px -55% 0px', threshold: 0 });
    Object.keys(navNames).forEach(id => observer.observe($(id)));
  }
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderChart, 150); });
  const cache = read(CACHE_KEY);
  if (cache?.version === 1 && cache.source) {
    for (const key of ['meals', 'daily']) {
      const source = cache.source[key];
      if (source?.table && Array.isArray(source.table.cols) && Array.isArray(source.table.rows) && source.table.rows.every(r => r && Array.isArray(r.c)) && Number.isFinite(Date.parse(source.fetchedAt))) state.source[key] = { ...source, fresh: false };
    }
  }
  const requestedDate = N.isoDate(new URL(location.href).searchParams.get('date'));
  if (requestedDate && requestedDate <= today() && requestedDate >= '2000-01-01') { state.selected = requestedDate; state.autoSelect = false; state.chartEnd = requestedDate < N.rangeDates(today(), 7)[0] ? requestedDate : today(); }
  hydrate(); state.ready = !!Object.keys(state.source).length; populatePresets(); renderAll(); bindSheetLinks(); loadAll();
  setInterval(loadAll, 15 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { const last = Math.max(0, ...Object.values(state.source).map(s => Date.parse(s.fetchedAt))); if (Date.now() - last > 15 * 60 * 1000) loadAll(); } });
})();
