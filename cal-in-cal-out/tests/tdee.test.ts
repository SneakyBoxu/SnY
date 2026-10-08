import { addDays, todayISO } from '../src/lib/date';
import {
  computeMacroTargets,
  computeTarget,
  computeTdee,
  computeWeightTrendSeries,
  computeWeeklyCheckIn,
  estimateTdee,
  KCAL_PER_KG_PER_DAY,
  makeTrendLookup,
} from '../src/lib/tdee';
import { DEFAULT_SETTINGS } from '../src/lib/types';

function assertEq(actual: unknown, expected: unknown, msg?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg ?? 'assertEq'}: expected ${e}, got ${a}`);
  }
}

function assertOk(v: unknown, msg?: string) {
  if (!v) throw new Error(`assertOk failed: ${msg ?? ''}`);
}

function assertClose(actual: number, expected: number, tol: number, msg?: string) {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(`${msg ?? 'assertClose'}: |${actual} - ${expected}| > ${tol}`);
  }
}

function buildDays(
  count: number,
  startWeight: number,
  driftPerDay: number,
  dailyCalories: number,
  today = todayISO(),
) {
  const start = addDays(today, -(count - 1));
  const days: { date: string; weight: number | null; calories: number | null }[] = [];
  for (let i = 0; i < count; i++) {
    days.push({
      date: addDays(start, i),
      weight: startWeight + driftPerDay * i,
      calories: dailyCalories,
    });
  }
  return days;
}

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

console.log('tdee engine tests:');

test('EWMA stays flat for constant weight', () => {
  const series = computeWeightTrendSeries(
    Array.from({ length: 20 }, (_, i) => ({
      date: `2026-09-${`${i + 1}`.padStart(2, '0')}`,
      weight: 80,
    })),
    0.12,
  );
  assertClose(series[19].trend, 80, 1e-9);
});

test('EWMA lags but follows a spike partially', () => {
  const pts = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-09-${`${i + 1}`.padStart(2, '0')}`,
    weight: i === 9 ? 90 : 80,
  }));
  const series = computeWeightTrendSeries(pts, 0.1);
  const last = series[9].trend;
  assertOk(last > 80 && last < 90, `trend ${last}`);
  assertClose(last, 0.1 * 90 + 0.9 * 80, 1e-9);
});

test('steady deficit yields TDEE = intake + deficit', () => {
  const drift = -0.5 / 7;
  const days = buildDays(30, 80, drift, 2000);
  const res = computeTdee(days, {
    weightAlpha: 0.12,
    tdeeAlpha: 0.25,
    minIntakeDays: 4,
  });
  assertOk(res.points.length > 0);
  const last = res.points[res.points.length - 1];
  assertClose(last.weeklyChangeKg, -0.5, 0.05, `weeklyChange ${last.weeklyChangeKg}`);
  assertClose(last.tdee, 2550, 60, `tdee ${last.tdee}`);
});

test('steady surplus yields TDEE = intake - surplus', () => {
  const days = buildDays(30, 80, 0.5 / 7, 3000);
  const res = computeTdee(days, { weightAlpha: 0.12, tdeeAlpha: 0.25, minIntakeDays: 4 });
  const last = res.points[res.points.length - 1];
  assertClose(last.tdee, 2450, 60, `tdee ${last.tdee}`);
});

test('unlogged days are excluded from intake average', () => {
  const drift = -0.5 / 7;
  const base = buildDays(40, 80, drift, 2000);
  base[2].calories = null;
  base[5].calories = null;
  base[8].calories = null;
  const res = computeTdee(base, { weightAlpha: 0.12, tdeeAlpha: 0.25, minIntakeDays: 3 });
  const last = res.points[res.points.length - 1];
  assertEq(last.loggedDays, 7);
  assertClose(last.tdee, 2550, 60, `tdee ${last.tdee}`);
});

test('respects minIntakeDays gate', () => {
  const days = buildDays(30, 80, -0.5 / 7, 2000);
  for (let i = 25; i < 30; i++) days[i].calories = null;
  const res = computeTdee(days, { weightAlpha: 0.12, tdeeAlpha: 0.25, minIntakeDays: 4 });
  const lastDates = res.points.slice(-5).map((p) => p.date);
  assertOk(!lastDates.includes(days[29].date));
});

test('trendAt returns last value on or before date', () => {
  const series = computeWeightTrendSeries(
    [
      { date: '2026-09-01', weight: 80 },
      { date: '2026-09-05', weight: 81 },
    ],
    0.5,
  );
  const at = makeTrendLookup(series);
  assertEq(at('2026-08-30'), null);
  assertEq(at('2026-09-03'), series[0].trend);
  assertEq(at('2026-09-09'), series[1].trend);
});

test('mifflin estimate matches spec baseline', () => {
  const s = { sex: 'male' as const, height_cm: 170.2, age: 25, activity_multiplier: 1.36 };
  const est = estimateTdee(s, 78);
  const bmr = est / 1.36;
  assertClose(bmr, 1724, 2, `bmr ${bmr}`);
  assertClose(est, 2345, 5, `est ${est}`);
});

test('cut target = TDEE - rate * 1100', () => {
  const t = computeTarget({
    settings: { ...DEFAULT_SETTINGS, goal_rate_kg_per_week: -0.5, manual_target_calories: null },
    adaptiveTdee: 2500,
    estimatedTdee: 2300,
    validDays: 30,
    totalIntakeDays: 30, // Passed 21-day calibration lock
    activeBaselineCalories: 1950,
  });
  assertEq(t.calories, 1950);
  assertEq(t.source, 'adaptive');
  assertEq(t.confidence, 'high');
  assertEq(t.status, 'ACTIVE_ADAPTIVE');
});

test('21-day initial calibration lock holds target strictly to baseline', () => {
  const t = computeTarget({
    settings: { ...DEFAULT_SETTINGS, goal_rate_kg_per_week: -0.5, manual_target_calories: null },
    adaptiveTdee: 2800,
    estimatedTdee: 2300,
    validDays: 10,
    totalIntakeDays: 10, // Under 21 days
    activeBaselineCalories: 1840,
  });
  // Active target must remain locked to 1840 kcal baseline despite higher adaptiveTdee
  assertEq(t.calories, 1840);
  assertEq(t.status, 'CALIBRATING');
  assertEq(t.calibrationProgress, 10);
});

test('weekly compliance gate requires at least 5 days logged', () => {
  const checkIn = computeWeeklyCheckIn({
    settings: { ...DEFAULT_SETTINGS, goal_rate_kg_per_week: -0.5 },
    currentCalories: 1840,
    adaptiveTdee: 2400,
    loggedDaysPastWeek: 3, // only 3 days logged
    trendWeightDelta: -0.2,
  });
  assertOk(checkIn !== null);
  assertEq(checkIn?.compliancePassed, false);
  assertEq(checkIn?.calorieDelta, 0); // target remains frozen
});

test('manual override wins', () => {
  const t = computeTarget({
    settings: { ...DEFAULT_SETTINGS, manual_target_calories: 2100 },
    adaptiveTdee: 2600,
    estimatedTdee: 2300,
    validDays: 30,
  });
  assertEq(t.calories, 2100);
  assertEq(t.source, 'manual');
});

test('estimate fallback before data converges', () => {
  const t = computeTarget({
    settings: { ...DEFAULT_SETTINGS, goal_rate_kg_per_week: -0.5, manual_target_calories: null },
    adaptiveTdee: null,
    estimatedTdee: 2300,
    validDays: 0,
  });
  assertEq(t.calories, Math.round(2300 - 0.5 * KCAL_PER_KG_PER_DAY));
  assertEq(t.source, 'estimate');
  assertEq(t.confidence, null);
});

test('auto target respects calorie floor', () => {
  const t = computeTarget({
    settings: { ...DEFAULT_SETTINGS, goal_rate_kg_per_week: -0.5, calorie_floor: 1600 },
    adaptiveTdee: 1700,
    estimatedTdee: 2300,
    validDays: 30,
    totalIntakeDays: 30,
    activeBaselineCalories: 1150, // lower than floor
  });
  assertEq(t.calories, 1600);
});

test('macro targets fill remaining calories with carbs', () => {
  const s = { ...DEFAULT_SETTINGS, protein_g_per_kg: 2.2, fat_g_per_kg: 0.7 };
  const m = computeMacroTargets(1950, s, 78);
  assertClose(m.protein, 171.6, 0.01);
  assertClose(m.fat, 54.6, 0.01);
  assertClose(m.carbs, (1950 - 171.6 * 4 - 54.6 * 9) / 4, 0.01);
});

console.log(`\n${passed} tests passed`);
