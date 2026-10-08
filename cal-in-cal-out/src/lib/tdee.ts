import { addDays, isoCompare } from '@/lib/date';
import { clamp } from '@/lib/num';
import type {
  AppSettings,
  CalibrationStatus,
  MacroTargets,
  Sex,
  TargetInfo,
  WeeklyCheckInRecommendation,
} from '@/lib/types';

export const KCAL_PER_KG_TISSUE = 7700;
export const KCAL_PER_KG_PER_DAY = KCAL_PER_KG_TISSUE / 7;

export interface DayInput {
  date: string;
  weight: number | null;
  calories: number | null;
}

export interface TdeePoint {
  date: string;
  tdee: number;
  rawTdee: number;
  trendWeight: number;
  weeklyChangeKg: number;
  avgIntake: number;
  loggedDays: number;
}

export interface TdeeResult {
  trendAt: (date: string) => number | null;
  points: TdeePoint[];
}

export function computeWeightTrendSeries(
  weights: { date: string; weight: number }[],
  alpha: number,
): { date: string; trend: number }[] {
  const sorted = [...weights].sort((a, b) => isoCompare(a.date, b.date));
  const out: { date: string; trend: number }[] = [];
  let prev: number | null = null;
  for (const p of sorted) {
    const trend: number = prev === null ? p.weight : alpha * p.weight + (1 - alpha) * prev;
    out.push({ date: p.date, trend });
    prev = trend;
  }
  return out;
}

export function makeTrendLookup(series: { date: string; trend: number }[]) {
  return (date: string): number | null => {
    let result: number | null = null;
    for (const p of series) {
      if (isoCompare(p.date, date) <= 0) result = p.trend;
      else break;
    }
    return result;
  };
}

export function mifflinStJeor(
  sex: Sex,
  weightKg: number,
  heightCm: number,
  age: number,
): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

export function estimateTdee(
  s: Pick<AppSettings, 'sex' | 'height_cm' | 'age' | 'activity_multiplier'>,
  weightKg: number | null,
): number {
  const w = weightKg ?? 75;
  return mifflinStJeor(s.sex, w, s.height_cm, s.age) * s.activity_multiplier;
}

export function computeTdee(
  days: DayInput[],
  opts: {
    weightAlpha: number;
    tdeeAlpha: number;
    minIntakeDays: number;
    windowDays?: number;
    rollingIntakeDays?: number;
  },
): TdeeResult {
  const window = opts.windowDays ?? 7;
  const rollingIntakeWindow = opts.rollingIntakeDays ?? 21; // Rolling 21-30 days window on Day 22+
  const sorted = [...days].sort((a, b) => isoCompare(a.date, b.date));
  const weightPoints = sorted
    .filter((d) => d.weight !== null)
    .map((d) => ({ date: d.date, weight: d.weight as number }));
  const trendSeries = computeWeightTrendSeries(weightPoints, opts.weightAlpha);
  const trendAt = makeTrendLookup(trendSeries);

  const raw: (TdeePoint & { raw: number })[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const day = sorted[i];
    const trendNow = trendAt(day.date);
    const trendPrev = trendAt(addDays(day.date, -window));
    if (trendNow === null || trendPrev === null) continue;

    // 1. Weekly compliance check: User must log at least minIntakeDays (e.g. 5) out of the past 7 days
    let recentWeekLogged = 0;
    for (let j = Math.max(0, i - (window - 1)); j <= i; j++) {
      if (sorted[j].calories !== null) {
        recentWeekLogged++;
      }
    }
    if (recentWeekLogged < opts.minIntakeDays) continue;

    // 2. Rolling intake estimation window (21-30 days window)
    let sum = 0;
    let logged = 0;
    const intakeLookback = Math.max(window, rollingIntakeWindow);
    for (let j = Math.max(0, i - (intakeLookback - 1)); j <= i; j++) {
      const c = sorted[j].calories;
      if (c !== null) {
        sum += c;
        logged++;
      }
    }
    if (logged === 0) continue;

    const avgIntake = sum / logged;
    const weeklyChangeKg = trendNow - trendPrev;
    const rawTdee = avgIntake - weeklyChangeKg * KCAL_PER_KG_PER_DAY;
    if (!Number.isFinite(rawTdee)) continue;
    raw.push({
      date: day.date,
      raw: rawTdee,
      rawTdee,
      tdee: rawTdee,
      trendWeight: trendNow,
      weeklyChangeKg,
      avgIntake,
      loggedDays: recentWeekLogged,
    });
  }

  const points: TdeePoint[] = [];
  let prev: number | null = null;
  for (const p of raw) {
    const smoothed: number =
      prev === null ? p.raw : opts.tdeeAlpha * p.raw + (1 - opts.tdeeAlpha) * prev;
    prev = smoothed;
    points.push({ ...p, tdee: smoothed });
  }

  return { trendAt, points };
}

export const INITIAL_CALIBRATION_DAYS = 21;
export const MIN_LOGGED_DAYS_PER_WEEK = 5;
export const MAX_WEEKLY_CALORIE_DELTA = 100;

export function confidenceFor(validDays: number): TargetInfo['confidence'] {
  if (validDays >= 28) return 'high';
  if (validDays >= 21) return 'medium';
  if (validDays > 0) return 'low';
  return null;
}

export function computeTarget(
  args: {
    settings: AppSettings;
    adaptiveTdee: number | null;
    estimatedTdee: number;
    validDays: number;
    totalIntakeDays?: number;
    weeklyComplianceDays?: number;
    activeBaselineCalories?: number;
    pendingCheckIn?: WeeklyCheckInRecommendation | null;
  },
): TargetInfo {
  const {
    settings,
    adaptiveTdee,
    estimatedTdee,
    validDays,
    totalIntakeDays = validDays,
    weeklyComplianceDays = 7,
    activeBaselineCalories,
    pendingCheckIn = null,
  } = args;

  const isCalibrating = totalIntakeDays < INITIAL_CALIBRATION_DAYS;
  const status: CalibrationStatus = isCalibrating ? 'CALIBRATING' : 'ACTIVE_ADAPTIVE';

  // 1. Manual override always takes absolute priority
  if (settings.manual_target_calories !== null) {
    return {
      calories: settings.manual_target_calories,
      source: 'manual',
      tdee: adaptiveTdee,
      estimatedTdee,
      confidence: confidenceFor(validDays),
      status,
      totalIntakeDays,
      calibrationProgress: Math.min(totalIntakeDays, INITIAL_CALIBRATION_DAYS),
      weeklyCompliance: weeklyComplianceDays,
      pendingCheckIn: null,
    };
  }

  // Calculate default baseline target from Mifflin estimation
  const floor = settings.calorie_floor ?? 1200;
  const estimatedTarget = clamp(
    Math.round(estimatedTdee + settings.goal_rate_kg_per_week * KCAL_PER_KG_PER_DAY),
    floor,
    6000,
  );

  const baselineCalories = activeBaselineCalories ?? estimatedTarget;

  // 2. Initial Calibration Gate (< 21 days):
  // Must remain strictly locked to initial baseline target
  if (isCalibrating) {
    return {
      calories: baselineCalories,
      source: 'estimate',
      tdee: adaptiveTdee,
      estimatedTdee,
      confidence: totalIntakeDays > 0 ? 'low' : null,
      status: 'CALIBRATING',
      totalIntakeDays,
      calibrationProgress: Math.min(totalIntakeDays, INITIAL_CALIBRATION_DAYS),
      weeklyCompliance: weeklyComplianceDays,
      pendingCheckIn: null,
    };
  }

  // 3. Day 22+ (ACTIVE_ADAPTIVE):
  // Active target remains at accepted baseline (or floor) unless explicitly confirmed via weekly check-in
  const activeCalories = clamp(baselineCalories, floor, 6000);

  return {
    calories: activeCalories,
    source: 'adaptive',
    tdee: adaptiveTdee,
    estimatedTdee,
    confidence: confidenceFor(validDays),
    status: 'ACTIVE_ADAPTIVE',
    totalIntakeDays,
    calibrationProgress: INITIAL_CALIBRATION_DAYS,
    weeklyCompliance: weeklyComplianceDays,
    pendingCheckIn,
  };
}

export function computeWeeklyCheckIn(args: {
  settings: AppSettings;
  currentCalories: number;
  adaptiveTdee: number | null;
  loggedDaysPastWeek: number;
  trendWeightDelta: number;
}): WeeklyCheckInRecommendation | null {
  const {
    settings,
    currentCalories,
    adaptiveTdee,
    loggedDaysPastWeek,
    trendWeightDelta,
  } = args;

  if (adaptiveTdee === null) return null;

  const compliancePassed = loggedDaysPastWeek >= MIN_LOGGED_DAYS_PER_WEEK;
  if (!compliancePassed) {
    return {
      eligible: false,
      compliancePassed: false,
      loggedDaysPastWeek,
      currentCalories,
      recommendedCalories: currentCalories,
      calorieDelta: 0,
      adaptiveTdee: Math.round(adaptiveTdee),
      trendWeightDelta,
      message: `Logged ${loggedDaysPastWeek}/7 days this week. Target remains frozen until at least 5/7 days are logged.`,
    };
  }

  // Target based on adaptive TDEE
  const floor = settings.calorie_floor ?? 1200;
  const idealTarget = clamp(
    Math.round(adaptiveTdee + settings.goal_rate_kg_per_week * KCAL_PER_KG_PER_DAY),
    floor,
    6000,
  );

  const rawDelta = idealTarget - currentCalories;
  // Cap at max safe change: +/- 50 to 100 kcal
  const clampedDelta = clamp(rawDelta, -MAX_WEEKLY_CALORIE_DELTA, MAX_WEEKLY_CALORIE_DELTA);
  const recommendedCalories = currentCalories + clampedDelta;

  return {
    eligible: true,
    compliancePassed: true,
    loggedDaysPastWeek,
    currentCalories,
    recommendedCalories,
    calorieDelta: clampedDelta,
    adaptiveTdee: Math.round(adaptiveTdee),
    trendWeightDelta,
    message:
      clampedDelta === 0
        ? 'Your metabolism and expenditure are perfectly aligned with your goal rate.'
        : `Algorithm recommends a ${clampedDelta > 0 ? '+' : ''}${clampedDelta} kcal adjustment to maintain your goal rate.`,
  };
}

export function computeMacroTargets(
  targetCalories: number,
  settings: AppSettings,
  weightKg: number | null,
): MacroTargets {
  const w = weightKg ?? 75;
  const protein = settings.protein_g_per_kg * w;
  const fat = settings.fat_g_per_kg * w;
  const carbs = Math.max(0, (targetCalories - protein * 4 - fat * 9) / 4);
  return { protein, carbs, fat };
}
