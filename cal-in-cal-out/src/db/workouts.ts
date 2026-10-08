import type { SQLiteDatabase } from 'expo-sqlite';

import { todayISO } from '@/lib/date';
import type {
  BodyPart,
  ExerciseItem,
  RoutineExerciseItem,
  RoutineItem,
  WorkoutDaySummary,
  WorkoutEntry,
} from '@/lib/types';
import { FOCUS_CYCLE, FOCUS_LABELS } from '@/db/seed-workouts';

export interface WorkoutLogInput {
  date: string;
  focusKey: string;
  exercise: string;
  weightLbs: string | null;
  weightLbsNum: number | null;
  sets: number | null;
  reps: string | null;
}

export function focusLabel(key: string, customMap?: Record<string, string>): string {
  if (customMap && customMap[key]) return customMap[key];
  return FOCUS_LABELS[key] ?? key;
}

export async function getCustomFocusLabels(
  db: SQLiteDatabase,
): Promise<Record<string, string>> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key LIKE 'routine_title_%'",
  );
  const result: Record<string, string> = { ...FOCUS_LABELS };
  for (const r of rows) {
    const focusKey = r.key.replace('routine_title_', '');
    if (r.value && r.value.trim()) {
      result[focusKey] = r.value.trim();
    }
  }
  return result;
}

export async function setCustomFocusLabel(
  db: SQLiteDatabase,
  key: string,
  label: string,
): Promise<void> {
  const clean = label.trim();
  const settingKey = `routine_title_${key}`;
  if (!clean) {
    await db.runAsync('DELETE FROM settings WHERE key = ?', [settingKey]);
  } else {
    await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [
      settingKey,
      clean,
    ]);
  }
}

export async function listWorkoutEntries(
  db: SQLiteDatabase,
  date: string,
): Promise<WorkoutEntry[]> {
  return db.getAllAsync<WorkoutEntry>(
    'SELECT * FROM workout_entries WHERE date = ? ORDER BY position, id',
    [date],
  );
}

export async function getWorkoutEntry(
  db: SQLiteDatabase,
  id: number,
): Promise<WorkoutEntry | null> {
  return db.getFirstAsync<WorkoutEntry>('SELECT * FROM workout_entries WHERE id = ?', [id]);
}

export async function insertWorkoutEntry(
  db: SQLiteDatabase,
  input: WorkoutLogInput,
): Promise<number> {
  const max = await db.getFirstAsync<{ m: number | null }>(
    'SELECT MAX(position) as m FROM workout_entries WHERE date = ?',
    [input.date],
  );
  const position = (max?.m ?? 0) + 1;
  const result = await db.runAsync(
    `INSERT INTO workout_entries
      (date, focus_key, exercise_name, weight_lbs, weight_lbs_num, sets, reps, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.date,
      input.focusKey,
      input.exercise.trim(),
      input.weightLbs,
      input.weightLbsNum,
      input.sets,
      input.reps,
      position,
    ],
  );
  return result.lastInsertRowId;
}

export async function updateWorkoutEntry(
  db: SQLiteDatabase,
  id: number,
  input: WorkoutLogInput,
): Promise<void> {
  await db.runAsync(
    `UPDATE workout_entries
     SET date = ?, focus_key = ?, exercise_name = ?, weight_lbs = ?, weight_lbs_num = ?,
         sets = ?, reps = ?
     WHERE id = ?`,
    [
      input.date,
      input.focusKey,
      input.exercise.trim(),
      input.weightLbs,
      input.weightLbsNum,
      input.sets,
      input.reps,
      id,
    ],
  );
}

export async function deleteWorkoutEntry(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM workout_entries WHERE id = ?', [id]);
}

export async function deleteWorkoutSession(
  db: SQLiteDatabase,
  date: string,
  focusKey?: string | null,
): Promise<void> {
  if (focusKey) {
    await db.runAsync('DELETE FROM workout_entries WHERE date = ? AND focus_key = ?', [
      date,
      focusKey,
    ]);
  } else {
    await db.runAsync('DELETE FROM workout_entries WHERE date = ?', [date]);
  }
}

export interface WorkoutSessionSummary {
  date: string;
  focusKey: string;
  count: number;
  preview: string;
}

export async function allWorkoutSessions(
  db: SQLiteDatabase,
  focusKeyFilter?: string | null,
): Promise<WorkoutSessionSummary[]> {
  const whereClause = focusKeyFilter ? 'WHERE focus_key = ?' : '';
  const params = focusKeyFilter ? [focusKeyFilter] : [];
  const rows = await db.getAllAsync<{ date: string; focus_key: string; cnt: number }>(
    `SELECT date, focus_key, COUNT(*) as cnt
     FROM workout_entries
     ${whereClause}
     GROUP BY date
     ORDER BY date DESC`,
    params,
  );

  const allEntries = await db.getAllAsync<{ date: string; exercise_name: string; weight_lbs: string | null }>(
    'SELECT date, exercise_name, weight_lbs FROM workout_entries ORDER BY date DESC, position ASC',
  );
  const previewMap = new Map<string, string[]>();
  for (const e of allEntries) {
    const list = previewMap.get(e.date) ?? [];
    if (list.length < 3) {
      list.push(`${e.exercise_name}${e.weight_lbs ? ` (${e.weight_lbs})` : ''}`);
    }
    previewMap.set(e.date, list);
  }

  return rows.map((r) => ({
    date: r.date,
    focusKey: r.focus_key,
    count: r.cnt,
    preview: (previewMap.get(r.date) ?? []).join(' · '),
  }));
}

export async function recentWorkoutDays(
  db: SQLiteDatabase,
  limit = 10,
): Promise<WorkoutDaySummary[]> {
  const rows = await db.getAllAsync<{ date: string; focus_key: string; cnt: number }>(
    `SELECT date, focus_key, COUNT(*) as cnt
     FROM workout_entries
     GROUP BY date
     ORDER BY date DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({ date: r.date, focusKey: r.focus_key, count: r.cnt }));
}

export async function getWorkoutDatesInRange(
  db: SQLiteDatabase,
  from: string,
  to: string,
): Promise<string[]> {
  const rows = await db.getAllAsync<{ date: string }>(
    'SELECT DISTINCT date FROM workout_entries WHERE date >= ? AND date <= ? ORDER BY date',
    [from, to],
  );
  return rows.map((r) => r.date);
}

export async function countWorkoutDays(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ cnt: number }>(
    'SELECT COUNT(DISTINCT date) as cnt FROM workout_entries',
  );
  return row?.cnt ?? 0;
}

export async function lastWorkoutFocusKey(db: SQLiteDatabase): Promise<string | null> {
  const row = await db.getFirstAsync<{ focus_key: string }>(
    `SELECT focus_key FROM workout_entries
     WHERE date = (SELECT MAX(date) FROM workout_entries)
     LIMIT 1`,
  );
  return row?.focus_key ?? null;
}

export function nextFocusInCycle(lastKey: string | null): string {
  if (lastKey === 'combined') return 'push';
  const idx = FOCUS_CYCLE.indexOf(lastKey ?? '');
  if (idx === -1) return 'push';
  return FOCUS_CYCLE[(idx + 1) % FOCUS_CYCLE.length];
}

export async function suggestedFocusKey(db: SQLiteDatabase): Promise<string> {
  const last = await lastWorkoutFocusKey(db);
  return nextFocusInCycle(last);
}

export interface RoutineCardData {
  focusKey: string;
  name: string;
  exercises: { exercise: string; sets: number; last: WorkoutEntry | null }[];
  totalSets: number;
}

export async function getAllRoutinesData(db: SQLiteDatabase): Promise<RoutineCardData[]> {
  const customMap = await getCustomFocusLabels(db);
  const result: RoutineCardData[] = [];

  // 1. Built-in routine cycle
  for (const focusKey of FOCUS_CYCLE) {
    const exerciseNames = await getTemplateExercises(db, focusKey);
    const exerciseRows = await Promise.all(
      exerciseNames.map(async (name) => {
        const last = await lastEntryForExercise(db, name);
        const sets = last?.sets ?? 3;
        return { exercise: name, sets, last };
      }),
    );
    const totalSets = exerciseRows.reduce((acc, cur) => acc + cur.sets, 0);
    result.push({
      focusKey,
      name: focusLabel(focusKey, customMap),
      exercises: exerciseRows,
      totalSets: totalSets > 0 ? totalSets : exerciseRows.length * 3,
    });
  }

  // 2. Custom User-Created Routines from `routines` table
  try {
    const customRoutines = await db.getAllAsync<{ id: number; name: string }>(
      'SELECT id, name FROM routines ORDER BY id ASC',
    );

    for (const cr of customRoutines) {
      const routineExercises = await db.getAllAsync<{
        exercise_name: string;
        target_sets: number;
      }>(
        `SELECT e.name as exercise_name, re.target_sets
         FROM routine_exercises re
         JOIN exercises e ON e.id = re.exercise_id
         WHERE re.routine_id = ?
         ORDER BY re.order_index ASC, re.id ASC`,
        [cr.id],
      );

      const exerciseRows = await Promise.all(
        routineExercises.map(async (re) => {
          const last = await lastEntryForExercise(db, re.exercise_name);
          const sets = re.target_sets || last?.sets || 3;
          return { exercise: re.exercise_name, sets, last };
        }),
      );

      const totalSets = exerciseRows.reduce((acc, cur) => acc + cur.sets, 0);
      result.push({
        focusKey: `custom_${cr.id}`,
        name: cr.name,
        exercises: exerciseRows,
        totalSets: totalSets > 0 ? totalSets : exerciseRows.length * 3,
      });
    }
  } catch (err) {
    console.warn('Error reading custom routines in getAllRoutinesData:', err);
  }

  return result;
}

export async function getTemplateExercises(
  db: SQLiteDatabase,
  focusKey: string,
): Promise<string[]> {
  const rows = await db.getAllAsync<{ exercise_name: string }>(
    'SELECT exercise_name FROM workout_templates WHERE focus_key = ? ORDER BY position, exercise_name',
    [focusKey],
  );
  return rows.map((r) => r.exercise_name);
}

export async function addTemplateExercise(
  db: SQLiteDatabase,
  focusKey: string,
  exerciseName: string,
): Promise<void> {
  const clean = exerciseName.trim();
  if (!clean) return;
  const exists = await db.getFirstAsync<{ exercise_name: string }>(
    'SELECT exercise_name FROM workout_templates WHERE focus_key = ? AND exercise_name = ?',
    [focusKey, clean],
  );
  if (exists) return;

  const maxPos = await db.getFirstAsync<{ m: number | null }>(
    'SELECT MAX(position) as m FROM workout_templates WHERE focus_key = ?',
    [focusKey],
  );
  const pos = (maxPos?.m ?? 0) + 1;
  await db.runAsync(
    'INSERT INTO workout_templates (focus_key, exercise_name, position) VALUES (?, ?, ?)',
    [focusKey, clean, pos],
  );
}

export async function removeTemplateExercise(
  db: SQLiteDatabase,
  focusKey: string,
  exerciseName: string,
): Promise<void> {
  await db.runAsync(
    'DELETE FROM workout_templates WHERE focus_key = ? AND exercise_name = ?',
    [focusKey, exerciseName],
  );
}

export async function topExercisesForFocus(
  db: SQLiteDatabase,
  focusKey: string,
): Promise<string[]> {
  const templateExercises = await getTemplateExercises(db, focusKey);
  const loggedRows = await db.getAllAsync<{ exercise_name: string }>(
    `SELECT exercise_name
     FROM workout_entries
     WHERE focus_key = ? AND weight_lbs_num IS NOT NULL
     GROUP BY exercise_name
     ORDER BY COUNT(*) DESC`,
    [focusKey],
  );
  const logged = loggedRows.map((r) => r.exercise_name);
  const set = new Set([...templateExercises, ...logged]);
  return Array.from(set);
}

export async function lastEntryForExercise(
  db: SQLiteDatabase,
  exercise: string,
  onOrBefore: string = todayISO(),
): Promise<WorkoutEntry | null> {
  return db.getFirstAsync<WorkoutEntry>(
    `SELECT * FROM workout_entries
     WHERE exercise_name = ? AND date <= ?
     ORDER BY date DESC, position DESC
     LIMIT 1`,
    [exercise, onOrBefore],
  );
}

export async function bestWeightForExercise(
  db: SQLiteDatabase,
  exercise: string,
): Promise<number | null> {
  const row = await db.getFirstAsync<{ m: number | null }>(
    'SELECT MAX(weight_lbs_num) as m FROM workout_entries WHERE exercise_name = ?',
    [exercise],
  );
  return row?.m ?? null;
}

export async function exerciseHistory(
  db: SQLiteDatabase,
  exercise: string,
): Promise<WorkoutEntry[]> {
  return db.getAllAsync<WorkoutEntry>(
    'SELECT * FROM workout_entries WHERE exercise_name = ? ORDER BY date ASC, position ASC',
    [exercise],
  );
}

export async function topExercises(db: SQLiteDatabase, limit = 10): Promise<string[]> {
  const rows = await db.getAllAsync<{ exercise_name: string }>(
    `SELECT exercise_name
     FROM workout_entries
     WHERE weight_lbs_num IS NOT NULL
     GROUP BY exercise_name
     ORDER BY COUNT(*) DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map((r) => r.exercise_name);
}

// -------------------------------------------------------------
// DECOUPLED MASTER EXERCISE CATALOG REPOSITORY
// -------------------------------------------------------------

export async function getExercises(
  db: SQLiteDatabase,
  bodyPart?: BodyPart | 'All',
  limit = 200,
): Promise<ExerciseItem[]> {
  if (bodyPart && bodyPart !== 'All') {
    return db.getAllAsync<ExerciseItem>(
      `SELECT * FROM exercises WHERE body_part = ? ORDER BY is_custom DESC, name COLLATE NOCASE ASC LIMIT ?`,
      [bodyPart, limit],
    );
  }
  return db.getAllAsync<ExerciseItem>(
    `SELECT * FROM exercises ORDER BY is_custom DESC, name COLLATE NOCASE ASC LIMIT ?`,
    [limit],
  );
}

export async function searchExercises(
  db: SQLiteDatabase,
  query: string,
  bodyPart?: BodyPart | 'All',
  limit = 100,
): Promise<ExerciseItem[]> {
  const clean = query.trim().toLowerCase();
  const filterPart = bodyPart && bodyPart !== 'All';

  if (!clean) {
    return getExercises(db, bodyPart, limit);
  }

  // Normalize so "pull up", "pull-up", "pullup" all match each other
  const spaced = clean.replace(/[-_]/g, ' ');
  const tight = clean.replace(/[^a-z0-9]/g, '') || '___nomatch___';
  const spacedPattern = `%${spaced}%`;
  const tightPattern = `%${tight}%`;

  const nameSpaced = `REPLACE(REPLACE(LOWER(name), '-', ' '), '_', ' ')`;
  const nameTight = `REPLACE(REPLACE(REPLACE(REPLACE(LOWER(name), '-', ''), '_', ''), ' ', ''), '.', '')`;
  const muscleSpaced = `REPLACE(REPLACE(LOWER(target_muscle), '-', ' '), '_', ' ')`;
  const equipSpaced = `REPLACE(REPLACE(LOWER(equipment), '-', ' '), '_', ' ')`;

  const matchExpr = `(
    ${nameSpaced} LIKE ?
    OR ${nameTight} LIKE ?
    OR ${muscleSpaced} LIKE ?
    OR ${equipSpaced} LIKE ?
  )`;

  if (filterPart) {
    return db.getAllAsync<ExerciseItem>(
      `SELECT * FROM exercises
       WHERE body_part = ? AND ${matchExpr}
       ORDER BY is_custom DESC, name COLLATE NOCASE ASC LIMIT ?`,
      [bodyPart, spacedPattern, tightPattern, spacedPattern, spacedPattern, limit],
    );
  }

  return db.getAllAsync<ExerciseItem>(
    `SELECT * FROM exercises
     WHERE ${matchExpr}
     ORDER BY is_custom DESC, name COLLATE NOCASE ASC LIMIT ?`,
    [spacedPattern, tightPattern, spacedPattern, spacedPattern, limit],
  );
}

export async function recentUsedExercises(
  db: SQLiteDatabase,
  limit = 12,
): Promise<ExerciseItem[]> {
  const rows = await db.getAllAsync<ExerciseItem>(
    `SELECT e.*
     FROM (
       SELECT exercise_name, MAX(date) AS last_used
       FROM workout_entries
       GROUP BY exercise_name
       ORDER BY last_used DESC
       LIMIT ?
     ) recent
     JOIN exercises e ON e.name = recent.exercise_name COLLATE NOCASE
     ORDER BY recent.last_used DESC`,
    [limit],
  );
  return rows;
}

export async function createCustomExercise(
  db: SQLiteDatabase,
  input: {
    name: string;
    body_part: BodyPart;
    target_muscle?: string;
    equipment?: string;
    notes?: string;
  },
): Promise<number> {
  const now = new Date().toISOString();
  const res = await db.runAsync(
    `INSERT INTO exercises (name, body_part, target_muscle, equipment, is_custom, notes, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
    [
      input.name.trim(),
      input.body_part,
      input.target_muscle?.trim() || 'General',
      input.equipment?.trim() || 'Barbell',
      input.notes?.trim() || null,
      now,
    ],
  );
  return res.lastInsertRowId;
}

export async function updateCustomExercise(
  db: SQLiteDatabase,
  id: number,
  input: {
    name: string;
    body_part: BodyPart;
    target_muscle?: string;
    equipment?: string;
    notes?: string;
  },
): Promise<void> {
  await db.runAsync(
    `UPDATE exercises
     SET name = ?, body_part = ?, target_muscle = ?, equipment = ?, notes = ?
     WHERE id = ? AND is_custom = 1`,
    [
      input.name.trim(),
      input.body_part,
      input.target_muscle?.trim() || 'General',
      input.equipment?.trim() || 'Barbell',
      input.notes?.trim() || null,
      id,
    ],
  );
}

export async function deleteCustomExercise(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync(`DELETE FROM exercises WHERE id = ? AND is_custom = 1`, [id]);
}

// -------------------------------------------------------------
// USER ROUTINES TEMPLATE SYSTEM
// -------------------------------------------------------------

export async function getRoutines(db: SQLiteDatabase): Promise<RoutineItem[]> {
  return db.getAllAsync<RoutineItem>('SELECT * FROM routines ORDER BY id ASC');
}

export async function createRoutine(db: SQLiteDatabase, name: string): Promise<number> {
  const now = new Date().toISOString();
  const res = await db.runAsync('INSERT INTO routines (name, created_at) VALUES (?, ?)', [
    name.trim(),
    now,
  ]);
  return res.lastInsertRowId;
}

export async function deleteRoutine(db: SQLiteDatabase, routineId: number): Promise<void> {
  await db.runAsync('DELETE FROM routines WHERE id = ?', [routineId]);
}

export async function getRoutineExercises(
  db: SQLiteDatabase,
  routineId: number,
): Promise<RoutineExerciseItem[]> {
  return db.getAllAsync<RoutineExerciseItem>(
    `SELECT re.*, e.name as exercise_name, e.body_part, e.equipment, e.is_custom
     FROM routine_exercises re
     JOIN exercises e ON e.id = re.exercise_id
     WHERE re.routine_id = ?
     ORDER BY re.order_index ASC, re.id ASC`,
    [routineId],
  );
}

export async function addExerciseToRoutine(
  db: SQLiteDatabase,
  routineId: number,
  exerciseId: number,
  targetSets = 3,
  targetReps = '8-12',
): Promise<number> {
  const maxRow = await db.getFirstAsync<{ max_idx: number | null }>(
    'SELECT MAX(order_index) as max_idx FROM routine_exercises WHERE routine_id = ?',
    [routineId],
  );
  const nextIdx = (maxRow?.max_idx ?? -1) + 1;

  const res = await db.runAsync(
    `INSERT INTO routine_exercises (routine_id, exercise_id, order_index, target_sets, target_reps)
     VALUES (?, ?, ?, ?, ?)`,
    [routineId, exerciseId, nextIdx, targetSets, targetReps],
  );
  return res.lastInsertRowId;
}

export async function removeExerciseFromRoutine(
  db: SQLiteDatabase,
  routineExerciseId: number,
): Promise<void> {
  await db.runAsync('DELETE FROM routine_exercises WHERE id = ?', [routineExerciseId]);
}

export async function reorderRoutineExercises(
  db: SQLiteDatabase,
  reorderedIds: number[],
): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < reorderedIds.length; i++) {
      await db.runAsync('UPDATE routine_exercises SET order_index = ? WHERE id = ?', [
        i,
        reorderedIds[i],
      ]);
    }
  });
}

