import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { C } from '@/constants/theme';
import { addDays, formatDayLabel, fromISODate, toLocalISODate, todayISO } from '@/lib/date';
import { fmtInt, fmtNum } from '@/lib/num';
import type { DailyLog, MealEntry, WorkoutEntry } from '@/lib/types';
import { useDb } from '@/db/db';
import { getDaysRange, listMealEntries } from '@/db/queries';
import { getWorkoutDatesInRange, listWorkoutEntries } from '@/db/workouts';
import { Card, CardTitle, Divider, Screen, Segmented, Txt } from '@/components/ui';

export type HabitType = 'food' | 'weighIn' | 'workout' | 'creatine';

const HABIT_CONFIG: Record<
  HabitType,
  {
    title: string;
    color: string;
    softColor: string;
    icon: keyof typeof Ionicons.glyphMap;
    unit: string;
  }
> = {
  food: {
    title: 'Food Logging',
    color: C.blue,
    softColor: C.blueSoft,
    icon: 'flame',
    unit: 'kcal',
  },
  weighIn: {
    title: 'Weigh-In',
    color: C.accent,
    softColor: C.accentSoft,
    icon: 'scale-outline',
    unit: 'kg',
  },
  workout: {
    title: 'Workouts',
    color: C.weight,
    softColor: C.weightSoft,
    icon: 'barbell-outline',
    unit: 'exercises',
  },
  creatine: {
    title: 'Creatine (5g)',
    color: C.fat,
    softColor: C.fatSoft,
    icon: 'flash-outline',
    unit: '',
  },
};

const HABIT_KEYS: HabitType[] = ['food', 'weighIn', 'workout', 'creatine'];
const HABIT_LABELS = ['Food Logging', 'Weigh-In', 'Workouts', 'Creatine'];

interface DayDetail {
  iso: string;
  isTracked: boolean;
  valueText: string;
  subText?: string;
  meals?: MealEntry[];
  workouts?: WorkoutEntry[];
}

export default function HabitDetailScreen() {
  const db = useDb();
  const params = useLocalSearchParams<{ habit?: HabitType }>();
  const initialHabit: HabitType = params.habit && HABIT_CONFIG[params.habit] ? params.habit : 'food';

  const [selectedHabit, setSelectedHabit] = useState<HabitType>(initialHabit);
  const [currentYear, setCurrentYear] = useState<number>(() => fromISODate(todayISO()).getFullYear());
  const [currentMonth, setCurrentMonth] = useState<number>(() => fromISODate(todayISO()).getMonth()); // 0-indexed

  const [allLogs, setAllLogs] = useState<Map<string, DailyLog>>(new Map());
  const [allWorkoutDates, setAllWorkoutDates] = useState<Set<string>>(new Set());
  const [selectedDayISO, setSelectedDayISO] = useState<string>(todayISO());
  const [dayDetail, setDayDetail] = useState<DayDetail | null>(null);

  const today = todayISO();
  const config = HABIT_CONFIG[selectedHabit];

  // Load all historical logs across whole year range (e.g. 2026)
  const loadHistory = useCallback(async () => {
    const from = '2026-01-01';
    const to = addDays(today, 60);
    const [logs, workoutDates] = await Promise.all([
      getDaysRange(db, from, to),
      getWorkoutDatesInRange(db, from, to),
    ]);
    const map = new Map<string, DailyLog>();
    for (const l of logs) map.set(l.date, l);
    setAllLogs(map);
    setAllWorkoutDates(new Set(workoutDates));
  }, [db, today]);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory]),
  );

  // Load selected day details
  useEffect(() => {
    let live = true;
    (async () => {
      const log = allLogs.get(selectedDayISO);
      const isWorkout = allWorkoutDates.has(selectedDayISO);
      let isTracked = false;
      let valueText = 'No entry';
      let subText: string | undefined;
      let meals: MealEntry[] | undefined;
      let workouts: WorkoutEntry[] | undefined;

      if (selectedHabit === 'food') {
        const cal = log?.total_calories;
        if (cal !== null && cal !== undefined && cal > 0) {
          isTracked = true;
          valueText = `${fmtInt(cal)} kcal logged`;
          meals = await listMealEntries(db, selectedDayISO);
          if (meals.length > 0) {
            subText = `${meals.length} items · ${fmtInt(log?.protein_g ?? 0)}P  ${fmtInt(log?.carbs_g ?? 0)}C  ${fmtInt(log?.fats_g ?? 0)}F`;
          }
        }
      } else if (selectedHabit === 'weighIn') {
        const w = log?.weight_kg;
        if (w !== null && w !== undefined) {
          isTracked = true;
          valueText = `${fmtNum(w)} kg scale weight`;
          if (log?.weight_trend_kg !== null && log?.weight_trend_kg !== undefined) {
            subText = `Trend: ${fmtNum(log.weight_trend_kg)} kg`;
          }
        }
      } else if (selectedHabit === 'workout') {
        if (isWorkout) {
          isTracked = true;
          workouts = await listWorkoutEntries(db, selectedDayISO);
          const focusName = workouts[0]?.focus_key ? workouts[0].focus_key : 'Session';
          valueText = `${workouts.length} exercises logged (${focusName})`;
          subText = workouts.map((w) => `${w.exercise_name} (${w.weight_lbs ?? 'BW'})`).slice(0, 3).join(', ');
        }
      } else if (selectedHabit === 'creatine') {
        if (log?.creatine_taken === 1) {
          isTracked = true;
          valueText = '5g Monohydrate Saturation';
          subText = 'Daily habit checked off';
        }
      }

      if (live) {
        setDayDetail({
          iso: selectedDayISO,
          isTracked,
          valueText,
          subText,
          meals,
          workouts,
        });
      }
    })();

    return () => {
      live = false;
    };
  }, [allLogs, allWorkoutDates, db, selectedDayISO, selectedHabit]);

  // Compute Streak & Today's Stat
  const getIsTrackedForDate = (iso: string): boolean => {
    const log = allLogs.get(iso);
    if (selectedHabit === 'food') {
      return log?.total_calories !== null && log?.total_calories !== undefined && log.total_calories > 0;
    }
    if (selectedHabit === 'weighIn') {
      return log?.weight_kg !== null && log?.weight_kg !== undefined;
    }
    if (selectedHabit === 'workout') {
      return allWorkoutDates.has(iso);
    }
    if (selectedHabit === 'creatine') {
      return log?.creatine_taken === 1;
    }
    return false;
  };

  // Streak calculation (consecutive days counting backwards from today or yesterday)
  let currentStreak = 0;
  let checkDate = today;
  if (!getIsTrackedForDate(checkDate)) {
    // Check if yesterday was tracked
    checkDate = addDays(today, -1);
  }
  while (getIsTrackedForDate(checkDate)) {
    currentStreak++;
    checkDate = addDays(checkDate, -1);
  }

  // Total counts for intermittent habits
  const totalWeighIns = [...allLogs.values()].filter(
    (l) => l.weight_kg !== null && l.weight_kg !== undefined,
  ).length;

  let rightStatLabel = 'Streak';
  let rightStatValue = currentStreak;
  let rightStatUnit = 'days';

  if (selectedHabit === 'workout') {
    rightStatLabel = 'Total Sessions';
    rightStatValue = allWorkoutDates.size;
    rightStatUnit = 'sessions';
  } else if (selectedHabit === 'weighIn') {
    rightStatLabel = 'Total Weigh-Ins';
    rightStatValue = totalWeighIns;
    rightStatUnit = 'entries';
  }

  // Today stat readout
  const todayLog = allLogs.get(today);
  let todayStatValue = '0';
  let todayStatUnit = config.unit;
  if (selectedHabit === 'food') {
    todayStatValue = todayLog?.total_calories ? fmtInt(todayLog.total_calories) : '0';
  } else if (selectedHabit === 'weighIn') {
    todayStatValue = todayLog?.weight_kg ? fmtNum(todayLog.weight_kg) : '—';
  } else if (selectedHabit === 'workout') {
    todayStatValue = allWorkoutDates.has(today) ? 'Logged' : 'Rest Day';
    todayStatUnit = '';
  } else if (selectedHabit === 'creatine') {
    todayStatValue = todayLog?.creatine_taken === 1 ? '5g' : '0g';
    todayStatUnit = todayLog?.creatine_taken === 1 ? 'Taken' : 'Pending';
  }

  // Month navigation
  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  // Generate Calendar Matrix for viewing month
  // Monday-based (0 = Mon, 6 = Sun)
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  // getDay(): 0=Sun, 1=Mon, ..., 6=Sat -> Convert to Monday=0
  const jsDay = firstDayOfMonth.getDay();
  const startDayOfWeek = (jsDay + 6) % 7; // 0=Mon, ..., 6=Sun

  const monthLabel = firstDayOfMonth.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const calendarWeeks: { dayNum: number | null; iso: string; isTracked: boolean; isToday: boolean }[][] = [];
  let currentWeek: { dayNum: number | null; iso: string; isTracked: boolean; isToday: boolean }[] = [];

  // Padding days before start of month
  for (let i = 0; i < startDayOfWeek; i++) {
    currentWeek.push({ dayNum: null, iso: '', isTracked: false, isToday: false });
  }

  // Days in month
  for (let d = 1; d <= daysInMonth; d++) {
    const dayDate = new Date(currentYear, currentMonth, d);
    const iso = toLocalISODate(dayDate);
    const isTracked = getIsTrackedForDate(iso);
    const isToday = iso === today;

    currentWeek.push({ dayNum: d, iso, isTracked, isToday });

    if (currentWeek.length === 7) {
      calendarWeeks.push(currentWeek);
      currentWeek = [];
    }
  }

  // Trailing empty cells
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push({ dayNum: null, iso: '', isTracked: false, isToday: false });
    }
    calendarWeeks.push(currentWeek);
  }

  return (
    <Screen
      title="Habits"
      subtitle={`${config.title} Consistency & Calendar`}
      onBack={() => router.back()}
    >
      {/* 1. HABIT SELECTOR PILL TABS */}
      <Segmented
        options={HABIT_LABELS}
        value={config.title}
        onChange={(label) => {
          const idx = HABIT_LABELS.indexOf(label);
          if (idx !== -1) setSelectedHabit(HABIT_KEYS[idx]);
        }}
      />

      {/* 2. TOP LEGEND ROW */}
      <View style={st.legendRow}>
        <View style={st.legendItem}>
          <View style={[st.legendCircle, { borderColor: config.color, backgroundColor: config.softColor }]} />
          <Txt size="xs" weight="700" color={C.text}>
            Tracked
          </Txt>
        </View>
        <View style={st.legendItem}>
          <View style={[st.legendCircle, { borderColor: C.borderLight, backgroundColor: 'transparent' }]} />
          <Txt size="xs" weight="600" color={C.dimmer}>
            Untracked
          </Txt>
        </View>
        <View style={st.legendItem}>
          <View style={[st.legendDot, { backgroundColor: C.accent }]} />
          <Txt size="xs" weight="600" color={C.dimmer}>
            Today
          </Txt>
        </View>
      </View>

      {/* 3. HERO STATS ROW (MacroFactor Style) */}
      <Card highlight style={{ padding: 18 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          {/* Today Stat */}
          <View style={{ gap: 2 }}>
            <Txt size="xs" weight="700" color={C.dimmer} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Today
            </Txt>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <Txt size="hero" weight="900" color={C.text} style={{ letterSpacing: -1 }}>
                {todayStatValue}
              </Txt>
              {todayStatUnit ? (
                <Txt size="md" weight="700" color={config.color}>
                  {todayStatUnit}
                </Txt>
              ) : null}
            </View>
          </View>

          {/* Right Stat: Total Count for Workouts/Weigh-Ins, Streak for daily habits */}
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Txt size="xs" weight="700" color={C.dimmer} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
              {rightStatLabel}
            </Txt>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <Txt size="hero" weight="900" color={config.color} style={{ letterSpacing: -1 }}>
                {rightStatValue}
              </Txt>
              <Txt size="md" weight="700" color={C.dim}>
                {rightStatUnit}
              </Txt>
            </View>
          </View>
        </View>
      </Card>

      {/* 4. CALENDAR MONTH NAVIGATOR & MATRIX */}
      <Card style={{ padding: 16 }}>
        {/* Month Navigator Header */}
        <View style={st.monthHeader}>
          <Pressable
            onPress={() => {
              setCurrentMonth(fromISODate(today).getMonth());
              setCurrentYear(fromISODate(today).getFullYear());
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Txt size="lg" weight="800" color={C.text}>
              {monthLabel}
            </Txt>
            <Ionicons name="calendar-outline" size={16} color={C.dim} />
          </Pressable>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Pressable onPress={prevMonth} style={st.navBtn}>
              <Ionicons name="chevron-back" size={18} color={C.text} />
            </Pressable>
            <Pressable onPress={nextMonth} style={st.navBtn}>
              <Ionicons name="chevron-forward" size={18} color={C.text} />
            </Pressable>
          </View>
        </View>

        <Divider />

        {/* Calendar Matrix */}
        <View style={{ gap: 10, marginTop: 6 }}>
          {/* Weekdays row */}
          <View style={st.weekdaysRow}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayName) => (
              <View key={dayName} style={st.calendarCol}>
                <Txt size="xs" weight="800" color={C.dimmer} align="center">
                  {dayName}
                </Txt>
              </View>
            ))}
          </View>

          {/* Calendar Day Rows */}
          {calendarWeeks.map((week, wIdx) => (
            <View key={wIdx} style={st.weekRow}>
              {week.map((day, dIdx) => {
                if (!day.dayNum) {
                  return <View key={dIdx} style={st.calendarCol} />;
                }

                const isSelected = day.iso === selectedDayISO;

                return (
                  <Pressable
                    key={dIdx}
                    onPress={() => setSelectedDayISO(day.iso)}
                    style={st.calendarCol}
                  >
                    <View
                      style={[
                        st.dayCircle,
                        day.isTracked && {
                          borderColor: config.color,
                          backgroundColor: config.softColor,
                          borderWidth: 2,
                        },
                        !day.isTracked && {
                          borderColor: C.borderLight,
                          borderWidth: 1,
                        },
                        isSelected && {
                          borderWidth: 2.5,
                          borderColor: C.text,
                        },
                      ]}
                    >
                      <Txt
                        size="sm"
                        weight={day.isTracked ? '800' : '600'}
                        color={day.isTracked ? C.text : C.dimmer}
                        align="center"
                      >
                        {String(day.dayNum)}
                      </Txt>

                      {day.isToday ? <View style={[st.todayDot, { backgroundColor: config.color }]} /> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </Card>

      {/* 5. SELECTED DAY DETAIL CARD */}
      {dayDetail ? (
        <Card highlight>
          <Pressable
            disabled={!dayDetail.isTracked}
            onPress={() => {
              if (selectedHabit === 'food') {
                router.push({
                  pathname: '/meal-detail' as any,
                  params: { date: dayDetail.iso },
                });
              } else if (selectedHabit === 'workout') {
                router.push({
                  pathname: '/workout-day' as any,
                  params: { date: dayDetail.iso },
                });
              }
            }}
            style={({ pressed }) => [
              pressed && dayDetail.isTracked && { opacity: 0.75 },
            ]}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="time-outline" size={16} color={config.color} />
                <Txt size="xs" weight="800" color={C.dimmer} style={{ letterSpacing: 0.8 }}>
                  {formatDayLabel(dayDetail.iso).toUpperCase()}
                </Txt>
              </View>

              {dayDetail.isTracked && (selectedHabit === 'food' || selectedHabit === 'workout') ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Txt size="xs" weight="700" color={config.color}>
                    View Log
                  </Txt>
                  <Ionicons name="chevron-forward" size={13} color={config.color} />
                </View>
              ) : null}
            </View>

            <View style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View
                  style={[
                    st.statusDot,
                    { backgroundColor: dayDetail.isTracked ? config.color : C.dimmer },
                  ]}
                />
                <Txt size="md" weight="800" color={dayDetail.isTracked ? C.text : C.dim}>
                  {dayDetail.valueText}
                </Txt>
              </View>
              {dayDetail.subText ? (
                <Txt size="xs" color={C.dim} weight="500">
                  {dayDetail.subText}
                </Txt>
              ) : null}
            </View>
          </Pressable>
        </Card>
      ) : null}
    </Screen>
  );
}

const st = StyleSheet.create({
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    paddingVertical: 2,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendCircle: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 4,
  },
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: C.surfaceHi,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  weekdaysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  calendarCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surfaceAlt,
  },
  todayDot: {
    position: 'absolute',
    bottom: 2,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
