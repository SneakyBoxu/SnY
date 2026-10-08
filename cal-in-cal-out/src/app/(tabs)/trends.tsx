import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, View, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { C } from '@/constants/theme';
import { addDays, daysBetween, todayISO } from '@/lib/date';
import { fmtInt, fmtNum, fmtSigned } from '@/lib/num';
import type { AppSettings, DailyLog, ExpenditureRow, WorkoutEntry } from '@/lib/types';
import { useDb } from '@/db/db';
import { ensureTodayRow } from '@/db/recalc';
import { getDaysRange, getExpenditureRange, getSettings, getTargetInfo } from '@/db/queries';
import {
  exerciseHistory,
  getAllRoutinesData,
  topExercises,
  topExercisesForFocus,
  type RoutineCardData,
} from '@/db/workouts';
import {
  computeNextProgressionTarget,
  computeProgressGain,
  computeSessionVolume,
  epley1rm,
  parseRepsAverage,
} from '@/lib/lifting';
import { TrendChart } from '@/components/TrendChart';
import {
  Card,
  CardTitle,
  Chip,
  ChipRow,
  Divider,
  EmptyHint,
  Screen,
  Segmented,
  Stat,
  StatCell,
  StatGrid,
  Txt,
} from '@/components/ui';

const RANGES: Record<string, number> = { '30d': 30, '90d': 90, '6m': 182 };

export default function TrendsScreen() {
  const db = useDb();
  const [metric, setMetric] = useState('Weight');
  const [range, setRange] = useState('90d');
  const [days, setDays] = useState<DailyLog[] | null>(null);
  const [expend, setExpend] = useState<ExpenditureRow[] | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [targetInfo, setTargetInfo] = useState<Awaited<ReturnType<typeof getTargetInfo>> | null>(
    null,
  );

  // Strength / Progressive Overload State
  const [exerciseList, setExerciseList] = useState<string[]>([]);
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const [exerciseLogs, setExerciseLogs] = useState<WorkoutEntry[] | null>(null);
  const [routinesList, setRoutinesList] = useState<RoutineCardData[]>([]);
  const [selectedRoutineKey, setSelectedRoutineKey] = useState<string | null>(null);
  const [showRoutineDropdown, setShowRoutineDropdown] = useState(false);

  const load = useCallback(async () => {
    await ensureTodayRow(db);
    const today = todayISO();
    const from = addDays(today, -(RANGES[range] - 1));
    const s = await getSettings(db);
    const [d, e, t, routines] = await Promise.all([
      getDaysRange(db, from, today),
      getExpenditureRange(db, from, today),
      getTargetInfo(db, s),
      getAllRoutinesData(db),
    ]);
    setDays(d);
    setExpend(e);
    setSettings(s);
    setTargetInfo(t);
    setRoutinesList(routines);
    setSelectedRoutineKey((prev) =>
      prev && routines.some((r) => r.focusKey === prev) ? prev : (routines[0]?.focusKey ?? null),
    );
  }, [db, range]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Load exercise options for the selected routine (falls back to global top exercises)
  useEffect(() => {
    let live = true;
    (async () => {
      const list = selectedRoutineKey
        ? await topExercisesForFocus(db, selectedRoutineKey)
        : await topExercises(db, 14);
      if (!live) return;
      setExerciseList(list);
      setSelectedExercise((prev) =>
        prev && list.includes(prev) ? prev : (list[0] ?? null),
      );
    })();
    return () => {
      live = false;
    };
  }, [db, selectedRoutineKey]);

  useEffect(() => {
    if (!selectedExercise) return;
    let live = true;
    exerciseHistory(db, selectedExercise).then((rows) => {
      if (live) setExerciseLogs(rows);
    });
    return () => {
      live = false;
    };
  }, [db, selectedExercise]);

  if (days === null || expend === null || settings === null || targetInfo === null) {
    return <Screen title="Trends & Analytics" loading />;
  }

  const today = todayISO();
  const from = addDays(today, -(RANGES[range] - 1));
  const allDates = daysBetween(from, today);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const expendByDate = new Map(expend.map((e) => [e.date, e]));

  const weightDots = allDates.map((d) => ({
    date: d,
    value: byDate.get(d)?.weight_kg ?? null,
  }));
  const trendLine = allDates.map((d) => ({
    date: d,
    value: byDate.get(d)?.weight_trend_kg ?? null,
  }));
  const calorieBars = allDates.map((d) => ({
    date: d,
    value: byDate.get(d)?.total_calories ?? null,
  }));
  const tdeeLine = allDates.map((d) => ({
    date: d,
    value: expendByDate.get(d)?.calculated_tdee ?? null,
  }));

  const trendNow = [...trendLine].reverse().find((p) => p.value !== null)?.value ?? null;
  const firstTrend = trendLine.find((p) => p.value !== null)?.value ?? null;
  const rawLatest = [...weightDots].reverse().find((p) => p.value !== null)?.value ?? null;
  const prevWeekTrend =
    [...trendLine].reverse().find((p) => p.date <= addDays(today, -7) && p.value !== null)?.value ??
    null;
  const weeklyChange =
    trendNow !== null && prevWeekTrend !== null ? trendNow - prevWeekTrend : null;

  const loggedDays = days.filter((d) => d.total_calories !== null);
  const avgIntake =
    loggedDays.length > 0
      ? loggedDays.reduce((a, d) => a + (d.total_calories ?? 0), 0) / loggedDays.length
      : null;
  const currentTdee = [...tdeeLine].reverse().find((p) => p.value !== null)?.value ?? null;
  const targetToday = targetInfo.target.calories;

  // Strength Progressive Overload Calculations
  const filteredExerciseLogs = (exerciseLogs ?? []).filter((e) => e.date >= from && e.weight_lbs_num !== null);
  const strengthSets = filteredExerciseLogs.length > 0 ? filteredExerciseLogs : (exerciseLogs ?? []).filter((e) => e.weight_lbs_num !== null);
  const strengthWeightPoints = strengthSets.map((e) => ({ date: e.date, value: e.weight_lbs_num }));
  const strengthOneRmPoints = strengthSets.map((e) => {
    const avgReps = parseRepsAverage(e.reps);
    return {
      date: e.date,
      value: avgReps !== null ? epley1rm(e.weight_lbs_num as number, avgReps) : null,
    };
  });
  const strengthOneRmValues = strengthOneRmPoints
    .map((p) => p.value)
    .filter((v): v is number => v !== null);

  // Progressive Overload Advanced Analytics (same as Workout tab — computed on full history)
  const analyticsSets = (exerciseLogs ?? []).filter((e) => e.weight_lbs_num !== null);
  const analyticsLast = analyticsSets.length > 0 ? analyticsSets[analyticsSets.length - 1] : null;
  const analyticsLastWeight = analyticsLast?.weight_lbs_num ?? null;
  const analyticsLastReps = analyticsLast?.reps ?? '12';
  const analyticsLastSets = analyticsLast?.sets ?? 3;
  const analyticsLastDate = analyticsLast
    ? (() => {
        const d = new Date(analyticsLast.date + 'T00:00:00');
        return `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}`;
      })()
    : '—';
  const analyticsNextTarget = computeNextProgressionTarget(analyticsLast);
  const analyticsVolume = computeSessionVolume(analyticsLast);
  const analyticsGain = computeProgressGain(exerciseLogs ?? []);
  const analyticsOneRmPoints = analyticsSets.map((e) => {
    const avgReps = parseRepsAverage(e.reps);
    return {
      date: e.date,
      value: avgReps !== null ? epley1rm(e.weight_lbs_num as number, avgReps) : null,
    };
  });
  const analyticsOneRmLast =
    [...analyticsOneRmPoints].reverse().find((p) => p.value !== null)?.value ?? null;
  const analyticsOneRmValues = analyticsOneRmPoints
    .map((p) => p.value)
    .filter((v): v is number => v !== null);
  const analyticsOneRmBest =
    analyticsOneRmValues.length > 0 ? Math.max(...analyticsOneRmValues) : null;

  const isEmpty =
    metric === 'Weight'
      ? !weightDots.some((p) => p.value !== null)
      : metric === 'Calories'
        ? !calorieBars.some((p) => p.value !== null)
        : metric === 'TDEE'
          ? !tdeeLine.some((p) => p.value !== null)
          : strengthWeightPoints.length === 0;

  return (
    <Screen title="Analytics" subtitle="MacroFactor-style progressive overload & metabolic trends">
      <Segmented
        options={['Weight', 'Calories', 'TDEE', 'Strength']}
        value={metric}
        onChange={setMetric}
      />
      <Segmented options={['30d', '90d', '6m']} value={range} onChange={setRange} />

      {/* MAIN CHART CARD */}
      <Card highlight={metric === 'Strength'}>
        <CardTitle
          icon={
            <Ionicons
              name={
                metric === 'Weight'
                  ? 'scale-outline'
                  : metric === 'Calories'
                    ? 'flame-outline'
                    : metric === 'TDEE'
                      ? 'speedometer-outline'
                      : 'barbell-outline'
              }
              size={16}
              color={metric === 'Strength' ? C.accent : metric === 'Weight' ? C.weight : C.blue}
            />
          }
        >
          {metric === 'TDEE'
            ? 'ADAPTIVE EXPENDITURE TREND'
            : metric === 'Strength'
              ? 'PROGRESSIVE OVERLOAD ANALYTICS'
              : `${metric.toUpperCase()} TREND`}
        </CardTitle>

        {metric === 'Strength' ? (
          <>
            {routinesList.length > 0 ? (
              <Pressable
                onPress={() => setShowRoutineDropdown(true)}
                style={({ pressed }) => [st.routineSelectorRowBtn, pressed && { opacity: 0.75 }]}
                hitSlop={6}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                  <Ionicons name="barbell" size={14} color={C.accent} />
                  <Txt size="sm" weight="800" color={C.text} numberOfLines={1}>
                    {routinesList.find((r) => r.focusKey === selectedRoutineKey)?.name ??
                      'Select Routine'}
                  </Txt>
                </View>
                <Ionicons name="chevron-down" size={14} color={C.dim} style={{ marginLeft: 6 }} />
              </Pressable>
            ) : null}

            {exerciseList.length > 0 ? (
              <ChipRow>
                {exerciseList.map((ex) => (
                  <Chip
                    key={ex}
                    label={ex}
                    active={ex === selectedExercise}
                    onPress={() => setSelectedExercise(ex)}
                  />
                ))}
              </ChipRow>
            ) : null}
          </>
        ) : null}

        {isEmpty ? (
          <EmptyHint
            icon={<Ionicons name="stats-chart-outline" size={32} color={C.dimmer} />}
            title="Not enough data in this range"
            sub={
              metric === 'TDEE'
                ? 'Needs ~1 week of weight + food logs to compute dynamic burn.'
                : metric === 'Strength'
                  ? 'No weighted sessions found for this exercise.'
                  : 'Log entries to build your historical curve.'
            }
          />
        ) : metric === 'Weight' ? (
          <TrendChart data={trendLine} dots={weightDots} color={C.weight} height={230} />
        ) : metric === 'Calories' ? (
          <TrendChart
            data={calorieBars}
            type="bars"
            color={C.kcal}
            target={targetInfo.target.calories}
            height={230}
          />
        ) : metric === 'TDEE' ? (
          <TrendChart
            data={tdeeLine}
            color={C.blue}
            target={targetToday}
            targetLabel={`target ${fmtInt(targetToday)}`}
            height={230}
          />
        ) : (
          <>
            <TrendChart
              data={strengthWeightPoints}
              secondary={strengthOneRmPoints}
              secondaryColor={C.blue}
              color={C.weight}
              yFormat={(n) => fmtNum(n, 1)}
              height={210}
            />
            <View style={st.legendBox}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 12, height: 3, backgroundColor: C.weight, borderRadius: 2 }} />
                <Txt size="xs" color={C.dim} weight="600">
                  Working Weight (lbs)
                </Txt>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 12, height: 3, backgroundColor: C.blue, borderRadius: 2 }} />
                <Txt size="xs" color={C.dim} weight="600">
                  Est. 1RM (Epley)
                </Txt>
              </View>
            </View>

            {/* 4 PROGRESSIVE OVERLOAD ADVANCED STAT METRICS (same as Workout tab) */}
            <View style={st.analyticsGrid}>
              {/* CARD 1: LAST PERFORMANCE */}
              <View style={st.analyticsCard}>
                <Txt size="xs" weight="800" color={C.dim} style={{ letterSpacing: 0.6 }}>
                  LAST PERFORMANCE
                </Txt>
                <View style={st.metricValuePill}>
                  <Txt size="sm" weight="900" color={C.text}>
                    {analyticsLastWeight !== null ? `${fmtNum(analyticsLastWeight, 1)} lbs × ${analyticsLastReps}` : '—'}
                  </Txt>
                </View>
                <Txt size="xs" color={C.dimmer} weight="600">
                  {`${analyticsLastDate} (${analyticsLastSets} sets)`}
                </Txt>
              </View>

              {/* CARD 2: NEXT TARGET (Green Accent) */}
              <View style={[st.analyticsCard, st.analyticsCardHighlight]}>
                <Txt size="xs" weight="800" color={C.accent} style={{ letterSpacing: 0.6 }}>
                  NEXT TARGET
                </Txt>
                <View style={[st.metricValuePill, { backgroundColor: C.accentSoft }]}>
                  <Txt size="sm" weight="900" color={C.accent}>
                    {analyticsNextTarget.targetLabel}
                  </Txt>
                </View>
                <Txt size="xs" color={C.accent} weight="700">
                  {analyticsNextTarget.advice}
                </Txt>
              </View>

              {/* CARD 3: SESSION VOLUME */}
              <View style={st.analyticsCard}>
                <Txt size="xs" weight="800" color={C.dim} style={{ letterSpacing: 0.6 }}>
                  SESSION VOLUME
                </Txt>
                <View style={st.metricValuePill}>
                  <Txt size="sm" weight="900" color={C.text}>
                    {analyticsVolume !== null ? `${fmtInt(analyticsVolume)} lbs` : '—'}
                  </Txt>
                </View>
                <Txt size="xs" color={C.dimmer} weight="600">
                  {'Total load (W × R × S)'}
                </Txt>
              </View>

              {/* CARD 4: EST. 1RM (EPLEY) */}
              <View style={st.analyticsCard}>
                <Txt size="xs" weight="800" color={C.dim} style={{ letterSpacing: 0.6 }}>
                  EST. 1RM (EPLEY)
                </Txt>
                <View style={st.metricValuePill}>
                  <Txt size="sm" weight="900" color={C.blue}>
                    {analyticsOneRmLast !== null ? `${fmtNum(analyticsOneRmLast, 0)} lbs` : '—'}
                  </Txt>
                </View>
                <Txt size="xs" color={C.dimmer} weight="600">
                  {analyticsGain
                    ? `${analyticsGain.percentGain >= 0 ? '+' : ''}${analyticsGain.percentGain}% since ${analyticsGain.firstDateFormatted}`
                    : analyticsOneRmBest !== null
                      ? `All-Time Best: ${fmtNum(analyticsOneRmBest, 0)} lbs`
                      : '1RM Epley Standard'}
                </Txt>
              </View>
            </View>
          </>
        )}
      </Card>

      {/* STATS DETAIL CARD */}
      {metric === 'Weight' ? (
        <Card>
          <CardTitle icon={<Ionicons name="scale-outline" size={16} color={C.weight} />}>
            WEIGHT METRICS
          </CardTitle>
          <StatGrid>
            <StatCell>
              <Stat label="Trend Weight" value={trendNow !== null ? `${fmtNum(trendNow)} kg` : '—'} color={C.weight} />
            </StatCell>
            <StatCell>
              <Stat label="Weekly Rate" value={weeklyChange !== null ? `${fmtSigned(weeklyChange)} kg/wk` : '—'} color={C.accent} />
            </StatCell>
            <StatCell>
              <Stat label="Latest Raw Scale" value={rawLatest !== null ? `${fmtNum(rawLatest)} kg` : '—'} />
            </StatCell>
            <StatCell>
              <Stat
                label={`Range Delta (${from.slice(5)})`}
                value={
                  trendNow !== null && firstTrend !== null
                    ? `${fmtSigned(trendNow - firstTrend)} kg`
                    : '—'
                }
              />
            </StatCell>
          </StatGrid>
          <Divider />
          <Txt size="xs" color={C.dimmer} weight="500">
            Purple curve = EWMA Trend Weight (filters out sodium, hydration, and creatine water noise). White dots = raw daily weigh-ins.
          </Txt>
        </Card>
      ) : metric === 'Calories' ? (
        <Card>
          <CardTitle icon={<Ionicons name="flame-outline" size={16} color={C.kcal} />}>
            CALORIC INTAKE
          </CardTitle>
          <StatGrid>
            <StatCell>
              <Stat
                label="Average Intake"
                value={avgIntake !== null ? `${fmtInt(avgIntake)} kcal` : '—'}
                color={C.kcal}
              />
            </StatCell>
            <StatCell>
              <Stat label="Active Target" value={`${fmtInt(targetToday)} kcal`} color={C.accent} />
            </StatCell>
            <StatCell>
              <Stat label="Logging Consistency" value={`${loggedDays.length} / ${allDates.length} days`} />
            </StatCell>
            <StatCell>
              <Stat
                label="Target Adherence"
                value={
                  avgIntake !== null && targetToday > 0
                    ? `${Math.round((avgIntake / targetToday) * 100)}%`
                    : '—'
                }
              />
            </StatCell>
          </StatGrid>
        </Card>
      ) : metric === 'TDEE' ? (
        <Card>
          <CardTitle icon={<Ionicons name="speedometer-outline" size={16} color={C.blue} />}>
            METABOLIC EXPENDITURE
          </CardTitle>
          <StatGrid>
            <StatCell>
              <Stat label="Dynamic TDEE" value={currentTdee !== null ? `${fmtInt(currentTdee)} kcal` : '—'} color={C.blue} />
            </StatCell>
            <StatCell>
              <Stat label="Calorie Target" value={`${fmtInt(targetToday)} kcal`} color={C.accent} />
            </StatCell>
            <StatCell>
              <Stat label="Strategy Phase" value={settings.phase} />
            </StatCell>
            <StatCell>
              <Stat
                label="Algorithm Status"
                value={
                  targetInfo.target.status === 'CALIBRATING'
                    ? `Calibrating (${targetInfo.target.calibrationProgress}/21d)`
                    : targetInfo.target.confidence === 'high'
                      ? 'High Confidence'
                      : 'Active Adaptive'
                }
                color={targetInfo.target.status === 'CALIBRATING' ? C.warn : C.accent}
              />
            </StatCell>
          </StatGrid>
          <Divider />
          <Txt size="xs" color={C.dimmer} weight="500">
            TDEE = 7-Day Rolling Intake − (Weekly Trend Δ × 1,100 kcal). Calculates your actual biological metabolic burn without relying on static BMR formulas.
          </Txt>
        </Card>
      ) : null}

      {/* Routine Selector Dropdown Modal (same UX as Workout tab) */}
      <Modal
        visible={showRoutineDropdown}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRoutineDropdown(false)}
      >
        <Pressable style={st.modalOverlay} onPress={() => setShowRoutineDropdown(false)}>
          <Pressable style={st.modalCard} onPress={(e) => e.stopPropagation?.()}>
            <View style={{ gap: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Txt size="lg" weight="900" color={C.text}>
                  Select Routine
                </Txt>
                <Pressable onPress={() => setShowRoutineDropdown(false)} style={{ padding: 4 }}>
                  <Ionicons name="close" size={20} color={C.dim} />
                </Pressable>
              </View>

              <View style={{ gap: 6 }}>
                {routinesList.map((r) => {
                  const active = r.focusKey === selectedRoutineKey;
                  return (
                    <Pressable
                      key={r.focusKey}
                      onPress={() => {
                        setSelectedRoutineKey(r.focusKey);
                        setShowRoutineDropdown(false);
                      }}
                      style={[st.dropdownItemRow, active && st.dropdownItemRowActive]}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Txt size="sm" weight={active ? '900' : '700'} color={active ? C.accent : C.text}>
                          {r.name}
                        </Txt>
                        <Txt size="xs" color={C.dimmer}>
                          {`${r.exercises.length} exercises · ${r.totalSets} sets`}
                        </Txt>
                      </View>
                      {active ? (
                        <Ionicons name="checkmark-circle" size={18} color={C.accent} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const st = StyleSheet.create({
  legendBox: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 6,
    backgroundColor: C.surfaceAlt,
    borderRadius: 10,
    marginTop: 6,
  },
  routineSelectorRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surfaceAlt,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    paddingVertical: 7,
    alignSelf: 'flex-start',
    minWidth: 140,
    maxWidth: 220,
  },
  analyticsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  analyticsCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: C.surfaceAlt,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
    gap: 8,
  },
  analyticsCardHighlight: {
    borderColor: C.accentSoft,
    backgroundColor: '#0C1C16',
  },
  metricValuePill: {
    backgroundColor: C.surfaceHi,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 20,
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderColor: C.borderLight,
    gap: 12,
  },
  dropdownItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surfaceAlt,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  dropdownItemRowActive: {
    borderColor: C.accent,
    backgroundColor: C.surfaceHi,
  },
});
