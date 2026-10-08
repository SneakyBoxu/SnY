import type { SQLiteDatabase } from 'expo-sqlite';

import { daysBetween, isoCompare, todayISO } from '@/lib/date';
import { computeTarget, computeTdee, estimateTdee, type TdeePoint } from '@/lib/tdee';
import type { AppSettings } from '@/lib/types';
import { getSettings } from '@/db/queries';

export async function recalculateAll(db: SQLiteDatabase): Promise<void> {
  const settings = await getSettings(db);
  const rows = await db.getAllAsync<{
    date: string;
    weight_kg: number | null;
    total_calories: number | null;
  }>('SELECT date, weight_kg, total_calories FROM daily_logs ORDER BY date');

  if (rows.length === 0) {
    await db.runAsync('DELETE FROM expenditure_history');
    return;
  }

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

  for (const d of days) {
    const trend = result.trendAt(d.date);
    if (d.weight !== null && trend !== null) {
      await db.runAsync('UPDATE daily_logs SET weight_trend_kg = ? WHERE date = ?', [
        trend,
        d.date,
      ]);
    }
  }

  await writeExpenditure(db, settings, result, days);
}

async function writeExpenditure(
  db: SQLiteDatabase,
  settings: AppSettings,
  result: ReturnType<typeof computeTdee>,
  days: { date: string; calories: number | null }[],
): Promise<void> {
  const today = todayISO();
  const firstDate = days[0]?.date ?? today;
  const points: TdeePoint[] = result.points;
  const validDays = points.length;

  await db.runAsync('DELETE FROM expenditure_history');

  const stmt = await db.prepareAsync(
    `INSERT INTO expenditure_history (date, calculated_tdee, target_calories, phase)
     VALUES (?, ?, ?, ?)`,
  );
  try {
    await db.withTransactionAsync(async () => {
      let carriedTdee: number | null = null;
      let pointIdx = 0;
      for (const date of daysBetween(firstDate, today)) {
        while (pointIdx < points.length && isoCompare(points[pointIdx].date, date) <= 0) {
          carriedTdee = points[pointIdx].tdee;
          pointIdx++;
        }
        const exact = points.find((p) => p.date === date) ?? null;
        const trendWeight = result.trendAt(date);
        const estimatedTdee = estimateTdee(settings, trendWeight);

        // Count intake days up to this date
        const intakeDaysUpToDate = days.filter(
          (d) => isoCompare(d.date, date) <= 0 && d.calories !== null && d.calories > 0,
        ).length;

        const target = computeTarget({
          settings,
          adaptiveTdee: exact ? exact.tdee : carriedTdee,
          estimatedTdee,
          validDays,
          totalIntakeDays: intakeDaysUpToDate,
        });
        await stmt.executeAsync([date, exact ? exact.tdee : null, target.calories, settings.phase]);
      }
    });
  } finally {
    await stmt.finalizeAsync();
  }
}

export async function ensureTodayRow(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ date: string }>(
    'SELECT date FROM expenditure_history WHERE date = ?',
    [todayISO()],
  );
  if (row) return;
  const any = await db.getFirstAsync<{ cnt: number }>('SELECT COUNT(*) as cnt FROM daily_logs');
  if ((any?.cnt ?? 0) > 0) {
    await recalculateAll(db);
  }
}
