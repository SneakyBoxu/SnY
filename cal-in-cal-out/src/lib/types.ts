export type MealType = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack';

export const MEAL_TYPES: MealType[] = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

export const PHASES = ['Cut', 'Recomp', 'Maintain', 'Bulk'] as const;
export type Phase = (typeof PHASES)[number];

export type Sex = 'male' | 'female';

export interface Food {
  id: number;
  food_name: string;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  category: string;
  is_seed: number;
  barcode?: string | null;
  serving_weight_grams?: number | null;
  serving_unit_name?: string | null;
}

export interface MealEntry {
  id: number;
  date: string;
  meal_type: MealType;
  food_name: string;
  serving_grams: number | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  food_id: number | null;
  per100_calories: number | null;
  per100_protein: number | null;
  per100_carbs: number | null;
  per100_fat: number | null;
}

export interface DailyLog {
  date: string;
  weight_kg: number | null;
  weight_trend_kg: number | null;
  total_calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fats_g: number | null;
  creatine_taken: number | null;
  notes: string | null;
}

export type BodyPart = 'Chest' | 'Back' | 'Shoulders' | 'Arms' | 'Legs' | 'Core';

export interface ExerciseItem {
  id: number;
  name: string;
  body_part: BodyPart;
  target_muscle: string;
  equipment: string;
  is_custom: number; // 0 = system, 1 = user-created
  notes?: string | null;
  created_at: string;
}

export interface RoutineItem {
  id: number;
  name: string;
  created_at: string;
}

export interface RoutineExerciseItem {
  id: number;
  routine_id: number;
  exercise_id: number;
  order_index: number;
  target_sets: number;
  target_reps: string;
  exercise_name?: string;
  body_part?: BodyPart;
  equipment?: string;
  is_custom?: number;
}

export interface WorkoutEntry {
  id: number;
  date: string;
  focus_key: string;
  exercise_name: string;
  weight_lbs: string | null;
  weight_lbs_num: number | null;
  sets: number | null;
  reps: string | null;
  position: number;
}

export interface WorkoutTemplateRow {
  focus_key: string;
  exercise_name: string;
  position: number;
}

export interface WorkoutDaySummary {
  date: string;
  focusKey: string;
  count: number;
}

export interface ExpenditureRow {
  date: string;
  calculated_tdee: number | null;
  target_calories: number | null;
  phase: string;
}

export interface AppSettings {
  height_cm: number;
  age: number;
  sex: Sex;
  activity_multiplier: number;
  phase: Phase;
  target_weight_kg: number;
  goal_rate_kg_per_week: number;
  weight_alpha: number;
  tdee_alpha: number;
  min_intake_days: number;
  protein_g_per_kg: number;
  fat_g_per_kg: number;
  calorie_floor: number;
  manual_target_calories: number | null;
  openfoodfacts_api_key?: string;
  gemini_api_key?: string;
}

export interface Supplement {
  id: number;
  name: string;
  dosage: string;
  description: string;
  is_active: number;
  position: number;
}

export interface SupplementEntry {
  supplement_id: number;
  date: string;
  taken: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  height_cm: 170.2,
  age: 25,
  sex: 'male',
  activity_multiplier: 1.375,
  phase: 'Recomp',
  target_weight_kg: 70.0,
  goal_rate_kg_per_week: -0.25,
  weight_alpha: 0.12,
  tdee_alpha: 0.25,
  min_intake_days: 5,
  protein_g_per_kg: 2.0,
  fat_g_per_kg: 0.7,
  calorie_floor: 1200,
  manual_target_calories: null,
  openfoodfacts_api_key: '',
  gemini_api_key: '',
};

export interface MacroTargets {
  protein: number;
  carbs: number;
  fat: number;
}

export type TargetSource = 'manual' | 'adaptive' | 'estimate';

export type CalibrationStatus = 'CALIBRATING' | 'ACTIVE_ADAPTIVE';

export interface TargetInfo {
  calories: number;
  source: TargetSource;
  tdee: number | null;
  estimatedTdee: number;
  confidence: 'low' | 'medium' | 'high' | null;
  status: CalibrationStatus;
  totalIntakeDays: number;
  calibrationProgress: number; // e.g. 4/21
  weeklyCompliance: number; // e.g. 5/7 days logged in rolling 7d
  pendingCheckIn?: WeeklyCheckInRecommendation | null;
}

export interface WeeklyCheckInRecommendation {
  eligible: boolean;
  compliancePassed: boolean;
  loggedDaysPastWeek: number;
  currentCalories: number;
  recommendedCalories: number;
  calorieDelta: number; // capped to +/- 50-100 kcal
  adaptiveTdee: number;
  trendWeightDelta: number;
  message: string;
}
