import { addDays, todayISO } from '@/lib/date';
import { round } from '@/lib/num';
import { KCAL_PER_KG_PER_DAY } from '@/lib/tdee';
import type { AppSettings, MacroTargets, Phase } from '@/lib/types';

export type GoalType = 'CUT' | 'MAINTAIN' | 'BULK';
export type GoalCompletionMetric = 'TREND_WEIGHT' | 'RAW_SCALE';

export interface UserGoalRecord {
  id?: number;
  created_at: string;
  goal_type: GoalType;
  start_weight_kg: number;
  target_weight_kg: number;
  target_rate_kg_per_week: number;
  goal_completion_metric: GoalCompletionMetric;
  daily_calorie_target: number;
  protein_target_g: number;
  is_active: number;
}

export type RateZone = 'gentle' | 'standard' | 'aggressive' | 'very_aggressive';

export interface RateZoneInfo {
  zone: RateZone;
  label: string;
  color: string;
  description: string;
}

export interface GoalCalculationResult {
  goalType: GoalType;
  phase: Phase;
  weightDeltaKg: number;
  absDeltaKg: number;
  signedRateKgPerWeek: number;
  absRateKgPerWeek: number;
  ratePctBwPerWeek: number;
  dailyCalorieDelta: number; // negative for deficit, positive for surplus
  dailyCalorieTarget: number;
  estimatedWeeks: number;
  projectedEndDateISO: string;
  projectedEndDateFormatted: string;
  rateZone: RateZoneInfo;
  macroTargets: MacroTargets;
  isFloorEnforced: boolean;
}

export function getRateZone(rateKgPerWeek: number, currentWeightKg: number): RateZoneInfo {
  const pctBw = currentWeightKg > 0 ? (rateKgPerWeek / currentWeightKg) * 100 : 0.5;

  if (rateKgPerWeek <= 0.4 || pctBw <= 0.45) {
    return {
      zone: 'gentle',
      label: 'Gentle / Muscle-Sparing',
      color: '#10B981', // Emerald
      description: 'Slow pace that maximizes muscle retention, training energy, and adherence.',
    };
  }
  if (rateKgPerWeek <= 0.7 || pctBw <= 0.8) {
    return {
      zone: 'standard',
      label: 'Standard / Recommended',
      color: '#38BDF8', // Cyan
      description: 'The sweet spot balance between noticeable weekly results and metabolic comfort.',
    };
  }
  if (rateKgPerWeek <= 1.0 || pctBw <= 1.15) {
    return {
      zone: 'aggressive',
      label: 'Aggressive Pace',
      color: '#FBBF24', // Amber
      description: 'Fast progress. Best for short timelines; requires strict protein intake.',
    };
  }
  return {
    zone: 'very_aggressive',
    label: 'Very Aggressive',
    color: '#F43F5E', // Rose/Red
    description: 'High fatigue risk. Monitor gym performance and energy levels closely.',
  };
}

export function calculateGoalPlan(args: {
  currentWeightKg: number;
  targetWeightKg: number;
  selectedRateKgPerWeek: number;
  currentTdee: number;
  settings: AppSettings;
  startDateISO?: string;
}): GoalCalculationResult {
  const {
    currentWeightKg,
    targetWeightKg,
    selectedRateKgPerWeek,
    currentTdee,
    settings,
    startDateISO = todayISO(),
  } = args;

  const weightDeltaKg = round(targetWeightKg - currentWeightKg, 2);
  const absDeltaKg = Math.abs(weightDeltaKg);

  let goalType: GoalType = 'MAINTAIN';
  let phase: Phase = 'Recomp';

  if (weightDeltaKg < -0.1) {
    goalType = 'CUT';
    phase = 'Cut';
  } else if (weightDeltaKg > 0.1) {
    goalType = 'BULK';
    phase = 'Bulk';
  } else {
    goalType = 'MAINTAIN';
    phase = 'Maintain';
  }

  const absRateKgPerWeek = Math.max(0, round(selectedRateKgPerWeek, 2));
  const signedRateKgPerWeek =
    goalType === 'CUT'
      ? -absRateKgPerWeek
      : goalType === 'BULK'
        ? absRateKgPerWeek
        : 0;

  const ratePctBwPerWeek =
    currentWeightKg > 0 ? round((absRateKgPerWeek / currentWeightKg) * 100, 2) : 0;

  // Caloric Deficit or Surplus formula (1 kg body tissue ~ 7,700 kcal / 7 days = 1,100 kcal/day)
  const dailyCalorieDelta = Math.round(signedRateKgPerWeek * KCAL_PER_KG_PER_DAY);
  const rawTarget = Math.round(currentTdee + dailyCalorieDelta);

  // Safety floor check (allow dynamic target calculation down to 600 kcal while flagging floor advisory)
  const floor = settings.calorie_floor ?? 1200;
  const isFloorEnforced = rawTarget < floor;
  const dailyCalorieTarget = Math.max(600, rawTarget);

  // Timeline / ETA calculation
  let estimatedWeeks = 0;
  if (goalType !== 'MAINTAIN' && absRateKgPerWeek > 0) {
    estimatedWeeks = round(absDeltaKg / absRateKgPerWeek, 1);
  }

  const totalDaysNeeded = Math.round(estimatedWeeks * 7);
  const projectedEndDateISO = addDays(startDateISO, totalDaysNeeded);

  const d = new Date(projectedEndDateISO + 'T00:00:00');
  const projectedEndDateFormatted =
    goalType === 'MAINTAIN'
      ? 'Goal Active'
      : `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`;

  const rateZone =
    goalType === 'MAINTAIN'
      ? {
          zone: 'gentle' as RateZone,
          label: 'Maintenance / Recomp',
          color: '#10B981',
          description: 'Holding bodyweight steady while fueling progressive overload in the gym.',
        }
      : getRateZone(absRateKgPerWeek, currentWeightKg);

  // Macro split recommendations
  const proteinGrams = Math.round(settings.protein_g_per_kg * currentWeightKg);
  const fatGrams = Math.round(settings.fat_g_per_kg * currentWeightKg);
  const remainingKcal = Math.max(0, dailyCalorieTarget - proteinGrams * 4 - fatGrams * 9);
  const carbsGrams = Math.round(remainingKcal / 4);

  return {
    goalType,
    phase,
    weightDeltaKg,
    absDeltaKg,
    signedRateKgPerWeek,
    absRateKgPerWeek,
    ratePctBwPerWeek,
    dailyCalorieDelta,
    dailyCalorieTarget,
    estimatedWeeks,
    projectedEndDateISO,
    projectedEndDateFormatted,
    rateZone,
    macroTargets: {
      protein: proteinGrams,
      fat: fatGrams,
      carbs: carbsGrams,
    },
    isFloorEnforced,
  };
}
