import { createContext, useContext, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import * as SQLite from 'expo-sqlite';

import { C } from '@/constants/theme';
import { SEED_FOODS, SEED_VERSION } from '@/db/seed-foods';
import SEED_EXERCISES_JSON from '@/db/seed-exercises.json';
import {
  WEIGHT_HISTORY,
  WORKOUT_HISTORY,
  WORKOUT_SEED_VERSION,
  WORKOUT_TEMPLATES,
} from '@/db/seed-workouts';
import { recalculateAll } from '@/db/recalc';
import { ensureDefaultSettings } from '@/db/queries';
import { extractServingInfo } from '@/lib/nutrition';

const DB_NAME = 'nutrition.db';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS daily_logs (
    date TEXT PRIMARY KEY,
    weight_kg REAL,
    weight_trend_kg REAL,
    total_calories REAL,
    protein_g REAL,
    carbs_g REAL,
    fats_g REAL,
    creatine_taken INTEGER,
    notes TEXT
);
CREATE TABLE IF NOT EXISTS meal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    meal_type TEXT,
    food_name TEXT,
    serving_grams REAL,
    calories REAL,
    protein REAL,
    carbs REAL,
    fat REAL,
    food_id INTEGER,
    per100_calories REAL,
    per100_protein REAL,
    per100_carbs REAL,
    per100_fat REAL,
    FOREIGN KEY(date) REFERENCES daily_logs(date) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_meal_entries_date ON meal_entries(date);
CREATE TABLE IF NOT EXISTS expenditure_history (
    date TEXT PRIMARY KEY,
    calculated_tdee REAL,
    target_calories REAL,
    phase TEXT
);
CREATE TABLE IF NOT EXISTS custom_foods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    food_name TEXT UNIQUE NOT NULL COLLATE NOCASE,
    calories_per_100g REAL NOT NULL,
    protein_per_100g REAL,
    carbs_per_100g REAL,
    fat_per_100g REAL,
    category TEXT DEFAULT 'General',
    is_seed INTEGER NOT NULL DEFAULT 0,
    barcode TEXT,
    serving_weight_grams REAL,
    serving_unit_name TEXT
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS workout_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    focus_key TEXT,
    exercise_name TEXT,
    weight_lbs TEXT,
    weight_lbs_num REAL,
    sets INTEGER,
    reps TEXT,
    position INTEGER
);
CREATE INDEX IF NOT EXISTS idx_workout_date ON workout_entries(date);
CREATE INDEX IF NOT EXISTS idx_workout_exercise ON workout_entries(exercise_name);
CREATE TABLE IF NOT EXISTS workout_templates (
    focus_key TEXT,
    exercise_name TEXT,
    position INTEGER
);
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
CREATE INDEX IF NOT EXISTS idx_user_goals_active ON user_goals(is_active);
CREATE TABLE IF NOT EXISTS supplements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    dosage TEXT NOT NULL,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS supplement_logs (
    supplement_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    taken INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(supplement_id, date),
    FOREIGN KEY(supplement_id) REFERENCES supplements(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_supp_logs_date ON supplement_logs(date);
CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL COLLATE NOCASE,
    body_part TEXT NOT NULL,
    target_muscle TEXT,
    equipment TEXT,
    is_custom INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exercises_body_part ON exercises(body_part);
CREATE INDEX IF NOT EXISTS idx_exercises_name ON exercises(name);
CREATE TABLE IF NOT EXISTS routines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS routine_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id INTEGER NOT NULL,
    exercise_id INTEGER NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    target_sets INTEGER NOT NULL DEFAULT 3,
    target_reps TEXT NOT NULL DEFAULT '8-12',
    FOREIGN KEY(routine_id) REFERENCES routines(id) ON DELETE CASCADE,
    FOREIGN KEY(exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_routine_exercises_routine ON routine_exercises(routine_id);
CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#10B981',
    builtin_key TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS habit_logs (
    habit_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(habit_id, date),
    FOREIGN KEY(habit_id) REFERENCES habits(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_habit_logs_date ON habit_logs(date);
`;

export async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.execAsync(SCHEMA_SQL);
  await migrateSchema(db);
  await seedFoods(db);
  await seedWorkoutData(db);
  await seedExercisesCatalog(db);
  await ensureDefaultSettings(db);
  await recalculateAll(db);
  return db;
}

async function migrateSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    await db.execAsync('ALTER TABLE daily_logs ADD COLUMN creatine_taken INTEGER;');
  } catch {}
  try {
    await db.execAsync('ALTER TABLE daily_logs ADD COLUMN notes TEXT;');
  } catch {}
  try {
    await db.execAsync('ALTER TABLE custom_foods ADD COLUMN barcode TEXT;');
  } catch {}
  try {
    await db.execAsync('CREATE INDEX IF NOT EXISTS idx_custom_foods_barcode ON custom_foods(barcode);');
  } catch {}
  try {
    await db.execAsync('ALTER TABLE custom_foods ADD COLUMN serving_weight_grams REAL;');
  } catch {}
  try {
    await db.execAsync('ALTER TABLE custom_foods ADD COLUMN serving_unit_name TEXT;');
  } catch {}
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
      CREATE INDEX IF NOT EXISTS idx_user_goals_active ON user_goals(is_active);
    `);
  } catch {}
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS supplements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        dosage TEXT NOT NULL,
        description TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        position INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS supplement_logs (
        supplement_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        taken INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY(supplement_id, date),
        FOREIGN KEY(supplement_id) REFERENCES supplements(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_supp_logs_date ON supplement_logs(date);
    `);
    // Seed default Creatine supplement if none exist
    const suppCount = await db.getFirstAsync<{ cnt: number }>('SELECT COUNT(*) as cnt FROM supplements');
    if (!suppCount || suppCount.cnt === 0) {
      await db.runAsync(
        `INSERT INTO supplements (name, dosage, description, is_active, position)
         VALUES ('Creatine Monohydrate', '5g', 'Saturated · Muscle energy restored', 1, 0)`
      );
    }
  } catch {}
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS exercises (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL COLLATE NOCASE,
        body_part TEXT NOT NULL,
        target_muscle TEXT,
        equipment TEXT,
        is_custom INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_exercises_body_part ON exercises(body_part);
      CREATE INDEX IF NOT EXISTS idx_exercises_name ON exercises(name);
      CREATE TABLE IF NOT EXISTS routines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS routine_exercises (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        routine_id INTEGER NOT NULL,
        exercise_id INTEGER NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        target_sets INTEGER NOT NULL DEFAULT 3,
        target_reps TEXT NOT NULL DEFAULT '8-12',
        FOREIGN KEY(routine_id) REFERENCES routines(id) ON DELETE CASCADE,
        FOREIGN KEY(exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_routine_exercises_routine ON routine_exercises(routine_id);
    `);
  } catch {}
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS habits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#10B981',
        builtin_key TEXT,
        hidden INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS habit_logs (
        habit_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY(habit_id, date),
        FOREIGN KEY(habit_id) REFERENCES habits(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_habit_logs_date ON habit_logs(date);
    `);
    // Seed the four built-in habits if the table is empty
    const habitCount = await db.getFirstAsync<{ cnt: number }>('SELECT COUNT(*) as cnt FROM habits');
    if (!habitCount || habitCount.cnt === 0) {
      await db.runAsync(
        `INSERT INTO habits (name, color, builtin_key, hidden, position) VALUES
          ('Workout', '#A855F7', 'workout', 0, 0),
          ('Food Logging', '#38BDF8', 'food', 0, 1),
          ('Creatine (5g)', '#2DD4BF', 'creatine', 0, 2),
          ('Weigh-In', '#10B981', 'weighIn', 0, 3)`,
      );
    }
  } catch {}
  try {
    const unserved = await db.getAllAsync<{ id: number; food_name: string }>(
      'SELECT id, food_name FROM custom_foods WHERE serving_weight_grams IS NULL',
    );
    for (const f of unserved) {
      const info = extractServingInfo(f.food_name);
      if (info.servingWeightGrams) {
        await db.runAsync(
          'UPDATE custom_foods SET serving_weight_grams = ?, serving_unit_name = ? WHERE id = ?',
          [info.servingWeightGrams, info.servingUnitName ?? null, f.id],
        );
      }
    }
  } catch {}
}

async function seedFoods(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'seed_version'",
  );
  const current = row ? Number(row.value) : 0;
  if (current >= SEED_VERSION) return;

  const stmt = await db.prepareAsync(
    `INSERT OR IGNORE INTO custom_foods
      (food_name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, category, is_seed, serving_weight_grams, serving_unit_name)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  try {
    await db.withTransactionAsync(async () => {
      for (const [name, kcal, p, c, f, category] of SEED_FOODS) {
        const info = extractServingInfo(name);
        await stmt.executeAsync([
          name,
          kcal,
          p,
          c,
          f,
          category,
          info.servingWeightGrams ?? null,
          info.servingUnitName ?? null,
        ]);
      }
      await db.runAsync(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('seed_version', ?)",
        String(SEED_VERSION),
      );
    });
  } finally {
    await stmt.finalizeAsync();
  }
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function seedWorkoutData(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'workout_seed_version'",
  );
  const current = row ? Number(row.value) : 0;
  if (current >= WORKOUT_SEED_VERSION) return;

  const entries = await db.getFirstAsync<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM workout_entries',
  );

  const stmt = await db.prepareAsync(
    `INSERT INTO workout_entries
      (date, focus_key, exercise_name, weight_lbs, weight_lbs_num, sets, reps, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  try {
    await db.withTransactionAsync(async () => {
      // Re-seed all workout entries with the updated Day 51 data
      await db.runAsync('DELETE FROM workout_entries');
      for (const w of WORKOUT_HISTORY) {
        await stmt.executeAsync([
          w.date,
          w.focusKey,
          w.exercise,
          w.weightLbs,
          w.weightLbsNum,
          w.sets,
          w.reps,
          w.position,
        ]);
      }
      await db.runAsync('DELETE FROM workout_templates');
      for (const t of WORKOUT_TEMPLATES) {
        await db.runAsync(
          'INSERT INTO workout_templates (focus_key, exercise_name, position) VALUES (?, ?, ?)',
          [t.focusKey, t.exercise, t.position],
        );
      }
      for (const w of WEIGHT_HISTORY) {
        await db.runAsync('INSERT OR IGNORE INTO daily_logs (date, weight_kg, notes) VALUES (?, ?, ?)', [
          w.date,
          w.kg,
          w.note ?? null,
        ]);
        await db.runAsync('UPDATE daily_logs SET weight_kg = ?, notes = ? WHERE date = ?', [
          w.kg,
          w.note ?? null,
          w.date,
        ]);
      }
      await db.runAsync(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('workout_seed_version', ?)",
        String(WORKOUT_SEED_VERSION),
      );
    });
  } finally {
    await stmt.finalizeAsync();
  }
}

const EXERCISES_SEED_VERSION = 4;

async function seedExercisesCatalog(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'exercises_seed_version'",
  );
  const current = row ? Number(row.value) : 0;
  if (current >= EXERCISES_SEED_VERSION) return;

  const now = new Date().toISOString();
  const stmt = await db.prepareAsync(
    `INSERT OR IGNORE INTO exercises (name, body_part, target_muscle, equipment, is_custom, notes, created_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  );

  try {
    await db.withTransactionAsync(async () => {
      for (const ex of SEED_EXERCISES_JSON) {
        await stmt.executeAsync([
          ex.name,
          ex.body_part,
          ex.target_muscle,
          ex.equipment,
          ex.instructions || null,
          now,
        ]);
      }

      // Remove legacy duplicate of "Pull-up" seeded in earlier versions
      await db.runAsync(
        `DELETE FROM exercises
         WHERE name = 'Pullups' AND is_custom = 0
           AND id NOT IN (SELECT exercise_id FROM routine_exercises)`,
      );

      await db.runAsync(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('exercises_seed_version', ?)",
        String(EXERCISES_SEED_VERSION),
      );
    });
  } finally {
    await stmt.finalizeAsync();
  }
}

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openDatabase().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

const DbContext = createContext<SQLite.SQLiteDatabase | null>(null);

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);

  useEffect(() => {
    let mounted = true;
    getDatabase()
      .then((d) => {
        if (mounted) setDb(d);
      })
      .finally(() => {
        SplashScreen.hideAsync().catch(() => {});
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (!db) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    );
  }
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>;
}

export function useDb(): SQLite.SQLiteDatabase {
  const db = useContext(DbContext);
  if (!db) throw new Error('useDb must be used within DatabaseProvider');
  return db;
}
