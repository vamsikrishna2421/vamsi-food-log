# Nouri — Vamsi's personal nutrition workspace

A responsive, dependency-free dashboard for the existing Google Sheet. Hosted at the existing GitHub Pages address. Fonts have system fallbacks; calculations and charts require no external libraries.

## Run locally

```sh
python -m http.server 8000
node --test tests/nutrition.test.cjs
```

## Files

- `index.html`: accessible page structure and icon symbols.
- `styles.css`: responsive desktop, tablet and mobile layouts.
- `nutrition.js`: pure Sheet parsing, date, aggregation, goal and trend calculations.
- `app.js`: data loading, browser cache, preferences, charts, journal and meal simulation.
- `tests/nutrition.test.cjs`: regression coverage for calculations and data-quality edge cases. Fixtures are synthetic.

## Data contract

The existing Sheet supplies `Meals` and `Daily summary` through Google's visualization JSON endpoint. Column names are preferred with original column positions as fallback. Sheet data is not embedded in the repository. The dashboard reads the Sheet; actual food entries are edited in Google Sheets.

Calories use summed meal values when all are present, otherwise the daily summary total if available. When both complete meal totals and a summary disagree, meals win and the discrepancy is disclosed. Missing values remain unknown. Add-on notes explicitly stating that macros are included elsewhere preserve that relationship without adding duplicate macros.

Charts show calendar windows, not just a fixed number of populated rows. Missing days remain blank. Averages and target counts use days with the relevant values present; the UI explicitly states these may still be incomplete food days. Per-date calorie ranges are preserved. Weight readings are plotted by date without extrapolation or a predicted finish date.

Original calorie and weight settings are retained: 2,100–2,300 kcal and 80 kg. Protein defaults to the earlier plan's provisional 128 g, visibly labeled until the user reviews it. These are configurable tracking targets, not established personal nutrition requirements. Carbs and fats are flexible. No unrecorded micronutrients, hydration, activity, sleep, or clinical health scores are inferred.

Preferences and the latest Sheet snapshot use browser-local storage with failure handling. Refreshes occur every 15 minutes and after a stale tab regains visibility. Failed or partly failed refreshes are labeled with source-specific saved timestamps. Each fetch has an 18-second timeout. All Sheet-originated text is escaped before rendering.

The meal lab is a what-if calculator. It accepts estimates or reuses a meal already in the log. It never writes to the Sheet. Unknown baseline or meal protein values remain unknown in projections.

## Release checks

Run the regression tests and syntax checks; inspect desktop and mobile rendering, date navigation, chart controls, search/filter, expandable meal details, preferences, and meal projections. Verify a real Sheet refresh and the live GitHub Pages result. No build step or server runtime is required.
