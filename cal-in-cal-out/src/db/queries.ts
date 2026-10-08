import type { SQLiteDatabase } from 'expo-sqlite';

import { addDays, isoCompare, todayISO } from '@/lib/date';
import { clamp } from '@/lib/num';
import type {
  AppSettings,
  DailyLog,
  ExpenditureRow,
  Food,
  MealEntry,
  MealType,
  TargetInfo,
  WeeklyCheckInRecommendation,
} from '@/lib/types';
import { DEFAULT_SETTINGS } from '@/lib/types';
import type { UserGoalRecord } from '@/lib/goalEngine';
import {
  computeMacroTargets,
  computeTarget,
  computeTdee,
  computeWeeklyCheckIn,
  estimateTdee,
} from '@/lib/tdee';

export async function ensureDefaultSettings(db: SQLiteDatabase): Promise<void> {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.runAsync('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [
      key,
      String(value),
    ]);
  }
}

export async function getSettings(db: SQLiteDatabase): Promise<AppSettings> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT * FROM settings');
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const num = (k: keyof AppSettings, d: number) => {
    const v = map.get(k);
    return v === undefined ? d : Number(v);
  };
  const phase = map.get('phase');
  const sex = map.get('sex');
  const manual = map.get('manual_target_calories');
  return {
    height_cm: num('height_cm', DEFAULT_SETTINGS.height_cm),
    age: num('age', DEFAULT_SETTINGS.age),
    sex: sex === 'female' ? 'female' : 'male',
    activity_multiplier: num('activity_multiplier', DEFAULT_SETTINGS.activity_multiplier),
    phase: (['Cut', 'Recomp', 'Maintain', 'Bulk'].includes(phase ?? '')
      ? phase
      : DEFAULT_SETTINGS.phase) as AppSettings['phase'],
    target_weight_kg: num('target_weight_kg', DEFAULT_SETTINGS.target_weight_kg),
    goal_rate_kg_per_week: num('goal_rate_kg_per_week', DEFAULT_SETTINGS.goal_rate_kg_per_week),
    weight_alpha: clamp(num('weight_alpha', DEFAULT_SETTINGS.weight_alpha), 0.02, 0.5),
    tdee_alpha: clamp(num('tdee_alpha', DEFAULT_SETTINGS.tdee_alpha), 0.05, 1),
    min_intake_days: Math.round(
      clamp(num('min_intake_days', DEFAULT_SETTINGS.min_intake_days), 1, 7),
    ),
    protein_g_per_kg: num('protein_g_per_kg', DEFAULT_SETTINGS.protein_g_per_kg),
    fat_g_per_kg: num('fat_g_per_kg', DEFAULT_SETTINGS.fat_g_per_kg),
    calorie_floor: num('calorie_floor', DEFAULT_SETTINGS.calorie_floor),
    manual_target_calories: manual === undefined || manual === 'null' ? null : Number(manual),
    openfoodfacts_api_key: map.get('openfoodfacts_api_key') ?? '',
    gemini_api_key: map.get('gemini_api_key') ?? '',
  };
}

export async function saveSettings(
  db: SQLiteDatabase,
  values: Partial<AppSettings>,
): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [
      key,
      String(value),
    ]);
  }
}

export async function ensureDay(db: SQLiteDatabase, date: string): Promise<void> {
  await db.runAsync('INSERT OR IGNORE INTO daily_logs (date) VALUES (?)', [date]);
}

export async function getDay(db: SQLiteDatabase, date: string): Promise<DailyLog | null> {
  return db.getFirstAsync<DailyLog>('SELECT * FROM daily_logs WHERE date = ?', [date]);
}

export async function getDaysRange(
  db: SQLiteDatabase,
  from: string,
  to: string,
): Promise<DailyLog[]> {
  return db.getAllAsync<DailyLog>(
    'SELECT * FROM daily_logs WHERE date >= ? AND date <= ? ORDER BY date',
    [from, to],
  );
}

export async function listMealEntries(db: SQLiteDatabase, date: string): Promise<MealEntry[]> {
  const rows = await db.getAllAsync<MealEntry>(
    'SELECT * FROM meal_entries WHERE date = ? ORDER BY id',
    [date],
  );
  return rows;
}

export interface MealEntryInput {
  date: string;
  mealType: MealType;
  foodName: string;
  grams: number | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  foodId: number | null;
  per100: { calories: number; protein: number; carbs: number; fat: number } | null;
}

export async function insertMealEntry(
  db: SQLiteDatabase,
  input: MealEntryInput,
): Promise<number> {
  await ensureDay(db, input.date);
  const result = await db.runAsync(
    `INSERT INTO meal_entries
      (date, meal_type, food_name, serving_grams, calories, protein, carbs, fat,
       food_id, per100_calories, per100_protein, per100_carbs, per100_fat)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.date,
      input.mealType,
      input.foodName,
      input.grams,
      input.calories,
      input.protein,
      input.carbs,
      input.fat,
      input.foodId,
      input.per100?.calories ?? null,
      input.per100?.protein ?? null,
      input.per100?.carbs ?? null,
      input.per100?.fat ?? null,
    ],
  );
  await refreshDayTotals(db, input.date);
  return result.lastInsertRowId;
}

export async function updateMealEntry(
  db: SQLiteDatabase,
  id: number,
  changes: { date: string; mealType: MealType; grams: number | null } & {
    per100?: MealEntryInput['per100'];
    totals?: { calories: number; protein: number; carbs: number; fat: number };
    foodName?: string;
  },
): Promise<string> {
  const existing = await db.getFirstAsync<MealEntry>('SELECT * FROM meal_entries WHERE id = ?', [
    id,
  ]);
  if (!existing) return '';
  const hasSnapshot =
    existing.per100_calories !== null &&
    existing.per100_protein !== null &&
    existing.per100_carbs !== null &&
    existing.per100_fat !== null;
  const per100 = changes.per100 ?? (hasSnapshot
    ? {
        calories: existing.per100_calories as number,
        protein: existing.per100_protein as number,
        carbs: existing.per100_carbs as number,
        fat: existing.per100_fat as number,
      }
    : null);
  const grams = changes.grams;
  let totals = changes.totals ?? null;
  if (!totals && per100 && grams !== null && grams > 0) {
    const r = grams / 100;
    totals = {
      calories: per100.calories * r,
      protein: per100.protein * r,
      carbs: per100.carbs * r,
      fat: per100.fat * r,
    };
  }
  if (!totals) {
    totals = {
      calories: existing.calories,
      protein: existing.protein,
      carbs: existing.carbs,
      fat: existing.fat,
    };
  }
  await ensureDay(db, changes.date);
  await db.runAsync(
    `UPDATE meal_entries
     SET date = ?, meal_type = ?, serving_grams = ?, calories = ?, protein = ?, carbs = ?, fat = ?,
         per100_calories = ?, per100_protein = ?, per100_carbs = ?, per100_fat = ?
     WHERE id = ?`,
    [
      changes.date,
      changes.mealType,
      grams,
      totals.calories,
      totals.protein,
      totals.carbs,
      totals.fat,
      per100?.calories ?? null,
      per100?.protein ?? null,
      per100?.carbs ?? null,
      per100?.fat ?? null,
      id,
    ],
  );
  await refreshDayTotals(db, existing.date);
  if (existing.date !== changes.date) await refreshDayTotals(db, changes.date);
  return existing.date;
}

export async function deleteMealEntry(db: SQLiteDatabase, id: number): Promise<void> {
  const existing = await db.getFirstAsync<{ date: string }>(
    'SELECT date FROM meal_entries WHERE id = ?',
    [id],
  );
  await db.runAsync('DELETE FROM meal_entries WHERE id = ?', [id]);
  if (existing) await refreshDayTotals(db, existing.date);
}

export async function refreshDayTotals(db: SQLiteDatabase, date: string): Promise<void> {
  const agg = await db.getFirstAsync<{
    cnt: number;
    calories: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
  }>(
    `SELECT COUNT(*) as cnt, SUM(calories) as calories, SUM(protein) as protein,
            SUM(carbs) as carbs, SUM(fat) as fat
     FROM meal_entries WHERE date = ?`,
    [date],
  );
  await ensureDay(db, date);
  if (agg && agg.cnt > 0) {
    await db.runAsync(
      `UPDATE daily_logs
       SET total_calories = ?, protein_g = ?, carbs_g = ?, fats_g = ?
       WHERE date = ?`,
      [agg.calories, agg.protein, agg.carbs, agg.fat, date],
    );
  } else {
    await db.runAsync(
      `UPDATE daily_logs
       SET total_calories = NULL, protein_g = NULL, carbs_g = NULL, fats_g = NULL
       WHERE date = ?`,
      [date],
    );
  }
}

export async function saveWeight(db: SQLiteDatabase, date: string, kg: number): Promise<void> {
  await ensureDay(db, date);
  await db.runAsync('UPDATE daily_logs SET weight_kg = ? WHERE date = ?', [kg, date]);
}

export async function clearWeight(db: SQLiteDatabase, date: string): Promise<void> {
  await db.runAsync('UPDATE daily_logs SET weight_kg = NULL WHERE date = ?', [date]);
}

export async function setCreatine(
  db: SQLiteDatabase,
  date: string,
  taken: boolean,
): Promise<void> {
  await ensureDay(db, date);
  await db.runAsync('UPDATE daily_logs SET creatine_taken = ? WHERE date = ?', [
    taken ? 1 : 0,
    date,
  ]);
}

const FOOD_SYNONYMS: Record<string, string[]> = {
  petcho: ['pecho', 'petcho', 'petso', 'breast'],
  pecho: ['pecho', 'petcho', 'petso', 'breast'],
  petso: ['pecho', 'petcho', 'petso'],
  inasal: ['inasal'],
  bbq: ['bbq', 'barbecue', 'barbeque'],
  barbecue: ['bbq', 'barbecue'],
  itlog: ['itlog', 'egg'],
  egg: ['egg', 'itlog'],
  manok: ['manok', 'chicken'],
  chicken: ['chicken', 'manok'],
  baboy: ['baboy', 'pork'],
  pork: ['pork', 'baboy'],
  baka: ['baka', 'beef'],
  beef: ['beef', 'baka'],
  kanin: ['kanin', 'rice'],
  rice: ['rice', 'kanin'],
  isda: ['isda', 'fish'],
  bangus: ['bangus', 'milkfish'],
  milkfish: ['milkfish', 'bangus'],
};

export async function searchFoods(
  db: SQLiteDatabase,
  query: string,
  category: string | null,
  limit = 100,
): Promise<Food[]> {
  const clean = query.trim();
  if (!clean) {
    const whereCategory = category ? 'WHERE category = ?' : '';
    const params: (string | number)[] = [];
    if (category) params.push(category);
    params.push(limit);
    return db.getAllAsync<Food>(
      `SELECT * FROM custom_foods ${whereCategory} ORDER BY food_name COLLATE NOCASE LIMIT ?`,
      params,
    );
  }

  // Multi-word and tokenized matching with synonym support
  const rawTokens = clean.toLowerCase().split(/\s+/).filter(Boolean);
  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  for (const token of rawTokens) {
    const syns = FOOD_SYNONYMS[token] ?? [token];
    const tokenClauses = syns.map(() => 'food_name LIKE ?');
    whereClauses.push(`(${tokenClauses.join(' OR ')})`);
    for (const s of syns) {
      params.push(`%${s}%`);
    }
  }

  if (category) {
    whereClauses.push('category = ?');
    params.push(category);
  }

  params.push(limit);
  const sql = `SELECT * FROM custom_foods WHERE ${whereClauses.join(' AND ')} ORDER BY food_name COLLATE NOCASE LIMIT ?`;
  const matches = await db.getAllAsync<Food>(sql, params);

  if (matches.length > 0) return matches;

  // Fallback: simple substring search
  const fallbackParams: (string | number)[] = [`%${clean}%`];
  const catWhere = category ? 'AND category = ?' : '';
  if (category) fallbackParams.push(category);
  fallbackParams.push(limit);

  return db.getAllAsync<Food>(
    `SELECT * FROM custom_foods WHERE food_name LIKE ? ${catWhere} ORDER BY food_name COLLATE NOCASE LIMIT ?`,
    fallbackParams,
  );
}

export async function listCategories(db: SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ category: string; cnt: number }>(
    'SELECT category, COUNT(*) as cnt FROM custom_foods GROUP BY category ORDER BY cnt DESC',
  );
  return rows.map((r) => r.category);
}

export async function getFood(db: SQLiteDatabase, id: number): Promise<Food | null> {
  return db.getFirstAsync<Food>('SELECT * FROM custom_foods WHERE id = ?', [id]);
}

export async function getFoodByBarcode(db: SQLiteDatabase, barcode: string): Promise<Food | null> {
  return db.getFirstAsync<Food>('SELECT * FROM custom_foods WHERE barcode = ?', [barcode.trim()]);
}

export async function getMealEntry(db: SQLiteDatabase, id: number): Promise<MealEntry | null> {
  return db.getFirstAsync<MealEntry>('SELECT * FROM meal_entries WHERE id = ?', [id]);
}

export async function createFood(
  db: SQLiteDatabase,
  food: Omit<Food, 'id' | 'is_seed'>,
): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO custom_foods
      (food_name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, category, is_seed, barcode, serving_weight_grams, serving_unit_name)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      food.food_name.trim(),
      food.calories_per_100g,
      food.protein_per_100g,
      food.carbs_per_100g,
      food.fat_per_100g,
      food.category || 'General',
      food.barcode ?? null,
      food.serving_weight_grams ?? null,
      food.serving_unit_name ?? null,
    ],
  );
  return result.lastInsertRowId;
}

export async function updateFood(
  db: SQLiteDatabase,
  id: number,
  food: Omit<Food, 'id' | 'is_seed'>,
): Promise<void> {
  await db.runAsync(
    `UPDATE custom_foods
     SET food_name = ?, calories_per_100g = ?, protein_per_100g = ?, carbs_per_100g = ?,
         fat_per_100g = ?, category = ?, barcode = ?, serving_weight_grams = ?, serving_unit_name = ?
     WHERE id = ? AND is_seed = 0`,
    [
      food.food_name.trim(),
      food.calories_per_100g,
      food.protein_per_100g,
      food.carbs_per_100g,
      food.fat_per_100g,
      food.category || 'General',
      food.barcode ?? null,
      food.serving_weight_grams ?? null,
      food.serving_unit_name ?? null,
      id,
    ],
  );
}

export async function deleteFood(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM custom_foods WHERE id = ? AND is_seed = 0', [id]);
}

export async function countFoods(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM custom_foods',
  );
  return row?.cnt ?? 0;
}

export async function getExpenditureRange(
  db: SQLiteDatabase,
  from: string,
  to: string,
): Promise<ExpenditureRow[]> {
  return db.getAllAsync<ExpenditureRow>(
    'SELECT * FROM expenditure_history WHERE date >= ? AND date <= ? ORDER BY date',
    [from, to],
  );
}

export async function getTodayExpenditure(
  db: SQLiteDatabase,
  date: string = todayISO(),
): Promise<ExpenditureRow | null> {
  return db.getFirstAsync<ExpenditureRow>(
    'SELECT * FROM expenditure_history WHERE date = ?',
    [date],
  );
}

export async function getTargetInfo(
  db: SQLiteDatabase,
  settings: AppSettings,
  date: string = todayISO(),
): Promise<{ target: TargetInfo; weightKg: number | null }> {
  const latest = await getLatestTdeePoint(db, settings, date);
  const estimated = estimateTdee(settings, latest.trendWeight);

  // 1. Total paired logging days (food intake days with calories > 0)
  const intakeCountRow = await db.getFirstAsync<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM daily_logs WHERE date <= ? AND total_calories > 0',
    [date],
  );
  const totalIntakeDays = intakeCountRow?.cnt ?? 0;

  // 2. Weekly compliance: intake logged in past 7 days (rolling window)
  const past7Row = await db.getFirstAsync<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM daily_logs 
     WHERE date <= ? AND date >= date(?, '-6 days') AND total_calories > 0`,
    [date, date],
  );
  const weeklyComplianceDays = past7Row?.cnt ?? 0;

  // 3. User's active baseline calorie target (from active goal or settings fallback)
  const activeGoal = await getActiveUserGoal(db);
  const activeBaselineCalories = activeGoal?.daily_calorie_target
    ? Math.round(activeGoal.daily_calorie_target)
    : undefined;

  // 4. Determine Weekly Check-in Recommendation if on Day 22+
  let pendingCheckIn: WeeklyCheckInRecommendation | null = null;
  if (totalIntakeDays >= 21) {
    const currentCal = activeBaselineCalories ?? Math.round(estimated);
    const weeklyDeltaTrend = latest.trendWeight !== null ? 0 : 0; // calculated in check-in
    pendingCheckIn = computeWeeklyCheckIn({
      settings,
      currentCalories: currentCal,
      adaptiveTdee: latest.tdee,
      loggedDaysPastWeek: weeklyComplianceDays,
      trendWeightDelta: weeklyDeltaTrend,
    });
  }

  const target = computeTarget({
    settings,
    adaptiveTdee: latest.tdee,
    estimatedTdee: estimated,
    validDays: latest.validDays,
    totalIntakeDays,
    weeklyComplianceDays,
    activeBaselineCalories,
    pendingCheckIn,
  });

  return { target, weightKg: latest.trendWeight };
}

export async function getMacroTargetsForDate(
  db: SQLiteDatabase,
  date: string = todayISO(),
): Promise<{
  settings: AppSettings;
  target: TargetInfo;
  macros: { protein: number; carbs: number; fat: number };
  weightKg: number | null;
}> {
  const settings = await getSettings(db);
  const { target, weightKg } = await getTargetInfo(db, settings, date);
  const macros = computeMacroTargets(target.calories, settings, weightKg);
  return { settings, target, macros, weightKg };
}

export async function getMacroTargetsForToday(
  db: SQLiteDatabase,
): Promise<{
  settings: AppSettings;
  target: TargetInfo;
  macros: { protein: number; carbs: number; fat: number };
  weightKg: number | null;
}> {
  return getMacroTargetsForDate(db, todayISO());
}

export async function getFoodLoggingStreak(db: SQLiteDatabase): Promise<number> {
  const today = todayISO();
  const rows = await db.getAllAsync<{ date: string }>(
    `SELECT date FROM daily_logs 
     WHERE date <= ? AND total_calories > 0 
     ORDER BY date DESC LIMIT 90`,
    [today],
  );
  if (!rows || rows.length === 0) return 0;
  const set = new Set(rows.map((r) => r.date));
  let cur = today;
  if (!set.has(cur)) {
    cur = addDays(today, -1);
  }
  let streak = 0;
  while (set.has(cur)) {
    streak++;
    cur = addDays(cur, -1);
  }
  return streak;
}

export async function getLoggedFoodDatesInRange(
  db: SQLiteDatabase,
  from: string,
  to: string,
): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ date: string }>(
    'SELECT date FROM daily_logs WHERE date >= ? AND date <= ? AND total_calories > 0',
    [from, to],
  );
  return new Set(rows.map((r) => r.date));
}


export async function hasAnyData(db: SQLiteDatabase): Promise<boolean> {
  const row = await db.getFirstAsync<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM meal_entries',
  );
  const w = await db.getFirstAsync<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM daily_logs WHERE weight_kg IS NOT NULL',
  );
  return (row?.cnt ?? 0) > 0 || (w?.cnt ?? 0) > 0;
}

export function sortEntriesByMeal(entries: MealEntry[]): MealEntry[] {
  const order: Record<string, number> = {
    Breakfast: 0,
    Lunch: 1,
    Dinner: 2,
    Snack: 3,
  };
  return [...entries].sort((a, b) => (order[a.meal_type] ?? 9) - (order[b.meal_type] ?? 9) || a.id - b.id);
}

export function entriesByMeal(
  entries: MealEntry[],
): { type: MealType; items: MealEntry[] }[] {
  const map = new Map<MealType, MealEntry[]>();
  for (const e of sortEntriesByMeal(entries)) {
    const list = map.get(e.meal_type) ?? [];
    list.push(e);
    map.set(e.meal_type, list);
  }
  return [...map.entries()].map(([type, items]) => ({ type, items }));
}

export function guessMealType(date = new Date()): MealType {
  const h = date.getHours();
  if (h < 11) return 'Breakfast';
  if (h < 16) return 'Lunch';
  if (h < 21) return 'Dinner';
  return 'Snack';
}

export async function getLatestTdeePoint(
  db: SQLiteDatabase,
  settings: AppSettings,
  date: string = todayISO(),
): Promise<{ tdee: number | null; trendWeight: number | null; validDays: number }> {
  const rows = await db.getAllAsync<{
    date: string;
    weight_kg: number | null;
    total_calories: number | null;
  }>('SELECT date, weight_kg, total_calories FROM daily_logs ORDER BY date');
  const days = rows.map((r) => ({
    date: r.date,
    weight: r.weight_kg,
    calories: r.total_calories,
  }));
  const result = computeTdee(days, {
    weightAlpha: settings.weight_alpha,
    tdeeAlpha: settings.tdee_alpha,
    minIntakeDays: settings.min_intake_days,
  });
  const trendWeight = result.trendAt(date);
  let tdee: number | null = null;
  for (const p of result.points) {
    if (isoCompare(p.date, date) <= 0) tdee = p.tdee;
  }
  const validDays = result.points.filter((p) => isoCompare(p.date, date) <= 0).length;
  return { tdee, trendWeight, validDays };
}

export async function createUserGoal(
  db: SQLiteDatabase,
  goal: Omit<UserGoalRecord, 'id' | 'is_active'>,
): Promise<number> {
  // Safeguard: Ensure table exists on client
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS user_goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        goal_type TEXT NOT NULL,
        start_weight_kg REAL NOT NULL,
        target_weight_kg REAL NOT NULL,
        target_rate_kg_per_week REAL NOT NULL,
        goal_completion_metric TEXT NOT NULL,
        daily_calorie_target REAL NOT NULL,
        protein_target_g REAL NOT NULL,
        is_active INTEGER DEFAULT 1
      );
    `);
  } catch {}

  // Mark all previous goals as inactive
  try {
    await db.runAsync('UPDATE user_goals SET is_active = 0 WHERE is_active = 1');
  } catch {}

  // Insert new active goal
  const res = await db.runAsync(
    `INSERT INTO user_goals
      (created_at, goal_type, start_weight_kg, target_weight_kg, target_rate_kg_per_week,
       goal_completion_metric, daily_calorie_target, protein_target_g, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      goal.created_at,
      goal.goal_type,
      goal.start_weight_kg,
      goal.target_weight_kg,
      goal.target_rate_kg_per_week,
      goal.goal_completion_metric,
      goal.daily_calorie_target,
      goal.protein_target_g,
    ],
  );

  // Sync settings
  await saveSettings(db, {
    target_weight_kg: goal.target_weight_kg,
    goal_rate_kg_per_week: goal.target_rate_kg_per_week,
    phase: goal.goal_type === 'CUT' ? 'Cut' : goal.goal_type === 'BULK' ? 'Bulk' : 'Maintain',
  });

  return res.lastInsertRowId;
}

export async function getActiveUserGoal(db: SQLiteDatabase): Promise<UserGoalRecord | null> {
  return db.getFirstAsync<UserGoalRecord>(
    'SELECT * FROM user_goals WHERE is_active = 1 ORDER BY id DESC LIMIT 1',
  );
}

export async function listUserGoals(db: SQLiteDatabase): Promise<UserGoalRecord[]> {
  return db.getAllAsync<UserGoalRecord>('SELECT * FROM user_goals ORDER BY id DESC');
}

export async function acceptWeeklyCheckInAdjustment(
  db: SQLiteDatabase,
  newCalories: number,
): Promise<void> {
  const activeGoal = await getActiveUserGoal(db);
  const now = new Date().toISOString();

  if (activeGoal && activeGoal.id) {
    await db.runAsync('UPDATE user_goals SET is_active = 0 WHERE id = ?', [activeGoal.id]);
    await db.runAsync(
      `INSERT INTO user_goals
        (created_at, goal_type, start_weight_kg, target_weight_kg, target_rate_kg_per_week,
         goal_completion_metric, daily_calorie_target, protein_target_g, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        now,
        activeGoal.goal_type,
        activeGoal.start_weight_kg,
        activeGoal.target_weight_kg,
        activeGoal.target_rate_kg_per_week,
        activeGoal.goal_completion_metric,
        newCalories,
        activeGoal.protein_target_g,
      ],
    );
  } else {
    await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('manual_target_calories', ?)", [
      String(newCalories),
    ]);
  }

  // Record date of check-in to space recommendations 7 days apart
  await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_checkin_date', ?)", [
    todayISO(),
  ]);
}

export async function deferWeeklyCheckIn(db: SQLiteDatabase): Promise<void> {
  await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_checkin_date', ?)", [
    todayISO(),
  ]);
}

export interface SupplementWithLog {
  id: number;
  name: string;
  dosage: string;
  description: string;
  is_active: number;
  position: number;
  taken: boolean;
}

export async function listSupplementsForDate(
  db: SQLiteDatabase,
  date: string,
): Promise<SupplementWithLog[]> {
  const rows = await db.getAllAsync<{
    id: number;
    name: string;
    dosage: string;
    description: string;
    is_active: number;
    position: number;
    taken: number | null;
  }>(
    `SELECT s.id, s.name, s.dosage, s.description, s.is_active, s.position,
            COALESCE(sl.taken, 0) as taken
     FROM supplements s
     LEFT JOIN supplement_logs sl ON sl.supplement_id = s.id AND sl.date = ?
     WHERE s.is_active = 1
     ORDER BY s.position ASC, s.id ASC`,
    [date],
  );
  return rows.map((r) => ({
    ...r,
    taken: r.taken === 1,
  }));
}

export async function toggleSupplementLog(
  db: SQLiteDatabase,
  supplementId: number,
  date: string,
  taken: boolean,
): Promise<void> {
  if (taken) {
    await db.runAsync(
      `INSERT OR REPLACE INTO supplement_logs (supplement_id, date, taken)
       VALUES (?, ?, 1)`,
      [supplementId, date],
    );
  } else {
    await db.runAsync(
      `DELETE FROM supplement_logs WHERE supplement_id = ? AND date = ?`,
      [supplementId, date],
    );
  }
}

export async function addSupplement(
  db: SQLiteDatabase,
  name: string,
  dosage: string,
  description: string,
): Promise<number> {
  const maxPosRow = await db.getFirstAsync<{ max_pos: number | null }>(
    'SELECT MAX(position) as max_pos FROM supplements',
  );
  const position = (maxPosRow?.max_pos ?? 0) + 1;
  const res = await db.runAsync(
    `INSERT INTO supplements (name, dosage, description, is_active, position)
     VALUES (?, ?, ?, 1, ?)`,
    [name.trim(), dosage.trim(), description.trim(), position],
  );
  return res.lastInsertRowId;
}

export async function updateSupplement(
  db: SQLiteDatabase,
  id: number,
  name: string,
  dosage: string,
  description: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE supplements SET name = ?, dosage = ?, description = ? WHERE id = ?`,
    [name.trim(), dosage.trim(), description.trim(), id],
  );
}

export async function deleteSupplement(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync(`DELETE FROM supplements WHERE id = ?`, [id]);
}

export interface HabitRow {
  id: number;
  name: string;
  color: string;
  builtin_key: string | null;
  hidden: number;
  position: number;
}

export async function listHabits(db: SQLiteDatabase): Promise<HabitRow[]> {
  return db.getAllAsync<HabitRow>('SELECT * FROM habits ORDER BY position ASC, id ASC');
}

export async function createHabit(db: SQLiteDatabase, name: string, color: string): Promise<void> {
  const posRow = await db.getFirstAsync<{ pos: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 as pos FROM habits',
  );
  await db.runAsync(
    'INSERT INTO habits (name, color, builtin_key, hidden, position) VALUES (?, ?, NULL, 0, ?)',
    [name.trim(), color, posRow?.pos ?? 0],
  );
}

export async function setHabitColor(db: SQLiteDatabase, id: number, color: string): Promise<void> {
  await db.runAsync('UPDATE habits SET color = ? WHERE id = ?', [color, id]);
}

export async function setHabitHidden(db: SQLiteDatabase, id: number, hidden: boolean): Promise<void> {
  await db.runAsync('UPDATE habits SET hidden = ? WHERE id = ?', [hidden ? 1 : 0, id]);
}

export async function deleteCustomHabit(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM habits WHERE id = ? AND builtin_key IS NULL', [id]);
}

export async function toggleHabitLog(
  db: SQLiteDatabase,
  habitId: number,
  date: string,
  done: boolean,
): Promise<void> {
  if (done) {
    await db.runAsync(
      `INSERT INTO habit_logs (habit_id, date, done) VALUES (?, ?, 1)
       ON CONFLICT(habit_id, date) DO UPDATE SET done = 1`,
      [habitId, date],
    );
  } else {
    await db.runAsync('DELETE FROM habit_logs WHERE habit_id = ? AND date = ?', [habitId, date]);
  }
}

