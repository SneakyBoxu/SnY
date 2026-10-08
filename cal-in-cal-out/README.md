# Cal In Cal Out

Offline-first adaptive nutrition + workout tracker. 100% of your data lives on the device in SQLite — no accounts, no cloud, no network calls.

## Run it

**On your phone** (best experience):

```bash
npm install
npx expo start
```

Scan the QR code with **Expo Go** (free app) on your phone (same Wi-Fi).

**On a desktop browser**:

```bash
npx expo export --platform web --output-dir dist   # production web build
node serve-web.mjs                                  # serves dist/ at http://localhost:8081
```

`serve-web.mjs` adds the cross-origin isolation headers (COOP/COEP) that expo-sqlite's WASM engine requires on web. Your data persists in the browser's storage. Note: the web **dev server** (`expo start --web`) currently fails to bundle due to an Expo SDK 57 dev-mode bug with the SQLite web worker chunk — the production export path above is the reliable desktop route.

## What's inside

**Today** — calories remaining vs your adaptive target, macro bars, daily weight logging with EWMA trend, creatine 5g check-off, meal log grouped by meal type.

**Foods** — ~200 USDA-style reference foods (per 100g) + your own custom foods. Search, categories, quick logging with gram-accurate portions from your food scale. Entries snapshot their macros, so editing the library never rewrites history.

**Workout** — your 5-day cycle (Push 1 / Pull / Legs / Push 2 / Arms & Core) with the next session suggested automatically, one-tap logging pre-filled from your last performance, per-exercise progressive-overload charts, and your full 49-session history imported from `Workout_Nutrition_Tracker_Day49_Strategized.xlsx`.

**Trends** — weight (raw + trend line), daily intake vs target, and the adaptive TDEE series with confidence tracking.

**Settings** — phase (Cut/Recomp/Maintain/Bulk), rate of change, manual override, 1,600 kcal muscle-protection floor, protein (g/kg) and fat (g/kg) targets, algorithm tuning, and your Phase 1/Phase 2 strategy notes.

## The adaptive TDEE algorithm

Static formulas guess your burn. This app measures it from energy balance:

- **Weight trend (EWMA):** `trend_t = α·weight_t + (1−α)·trend_(t−1)` with α = 0.12 — filters hydration/glycogen/sodium noise.
- **Weekly trend change:** `ΔW = trend_today − trend_(7 days ago)` (kg/week).
- **Expenditure:** `TDEE = 7-day avg intake − ΔW × 1100` (7,700 kcal ≈ 1 kg of tissue; ÷ 7 days).
- **Target:** `TDEE + rate × 1100`, clamped to your calorie floor. Unlogged days are excluded from the intake average rather than counted as zero.

Needs ~1 week of consistent weight + intake data before switching from the Mifflin-St Jeor estimate (your baseline: BMR ≈ 1,724, maintenance ≈ 2,350) to the adaptive value. Confidence grows with each logged week.

## Data model

Per the architecture spec: `daily_logs`, `meal_entries`, `expenditure_history`, `custom_foods` (SQLite via `expo-sqlite`), plus `workout_entries`, `workout_templates` and a `settings` key-value store. The pure math lives in `src/lib/tdee.ts` and is unit-tested.

## Development

```bash
npm test         # TDEE engine unit tests (tsx)
npm run lint     # expo lint
npm run typecheck
```

Seed data lives in `src/db/seed-foods.ts` and `src/db/seed-workouts.ts` (generated from the source xlsx — regenerate via the Python script pattern in git history).

## Roadmap

- **AI photo logging** — point the camera at a meal, a vision model drafts the items/portions, you confirm exact grams from the scale. The food-entry schema already snapshots per-100g values, so drafted entries will be first-class editable meal entries.
- Optional USDA FoodData Central online lookup (API key in Settings).
