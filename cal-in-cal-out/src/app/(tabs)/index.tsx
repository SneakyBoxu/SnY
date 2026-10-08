import { useCallback, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { C } from '@/constants/theme';
import { addDays, daysBetween, formatDayLabel, getMondayOfWeek, todayISO } from '@/lib/date';
import { fmtInt, fmtNum, fmtSigned, parseNumber, round } from '@/lib/num';
import type { AppSettings, DailyLog, MealEntry, MealType, TargetInfo } from '@/lib/types';
import { useDb } from '@/db/db';
import { recalculateAll } from '@/db/recalc';
import {
  acceptWeeklyCheckInAdjustment,
  addSupplement,
  createHabit,
  deferWeeklyCheckIn,
  deleteCustomHabit,
  deleteMealEntry,
  deleteSupplement,
  entriesByMeal,
  getDay,
  getDaysRange,
  getFoodLoggingStreak,
  getLoggedFoodDatesInRange,
  getMacroTargetsForDate,
  getSettings,
  guessMealType,
  listHabits,
  listMealEntries,
  listSupplementsForDate,
  saveWeight,
  setCreatine,
  setHabitColor,
  setHabitHidden,
  toggleHabitLog,
  toggleSupplementLog,
  updateSupplement,
  type HabitRow,
  type SupplementWithLog,
} from '@/db/queries';
import { getWorkoutDatesInRange } from '@/db/workouts';
import { HabitCard } from '@/components/HabitCard';
import { WeekCalendarStrip } from '@/components/WeekCalendarStrip';
import {
  Button,
  Card,
  CardTitle,
  Chip,
  ConfirmModal,
  Divider,
  MacroBar,
  NumberField,
  Ring,
  Screen,
  Txt,
} from '@/components/ui';

interface HabitCardData {
  id: number;
  name: string;
  color: string;
  builtinKey: string | null;
  activeDays: boolean[];
  weekStat: string;
  doneToday: boolean;
}

interface DayScreenData {
  day: DailyLog | null;
  entries: MealEntry[];
  groups: { type: MealType; items: MealEntry[] }[];
  settings: AppSettings;
  target: TargetInfo;
  proteinTarget: number;
  carbsTarget: number;
  fatTarget: number;
  trendWeight: number | null;
  weeklyChange: number | null;
  habitCards: HabitCardData[];
  allHabits: HabitRow[];
  streak: number;
  loggedDates: Set<string>;
  supplements: SupplementWithLog[];
}

const ALL_MEAL_TYPES: MealType[] = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

const HABIT_COLORS = [
  '#10B981', // emerald
  '#38BDF8', // blue
  '#A855F7', // purple
  '#F43F5E', // rose
  '#FBBF24', // amber
  '#2DD4BF', // teal
  '#EF4444', // red
  '#EC4899', // pink
];

async function loadDayData(
  db: ReturnType<typeof useDb>,
  selectedDate: string,
): Promise<DayScreenData> {
  const today = todayISO();
  const thirtyDaysFrom = addDays(today, -29);
  const thirtyDays = daysBetween(thirtyDaysFrom, today);
  const mondayOfThisWeek = getMondayOfWeek(today);
  const currentWeekDays = new Set(daysBetween(mondayOfThisWeek, today));
  const minStripDate = addDays(today, -100);
  const maxStripDate = addDays(today, 14);

  const [
    settings,
    { target, macros, weightKg },
    day,
    entries,
    prevRow,
    logs30d,
    workoutDatesList,
    streak,
    loggedDates,
    supplements,
    allHabits,
    habitLogRows,
  ] = await Promise.all([
    getSettings(db),
    getMacroTargetsForDate(db, selectedDate),
    getDay(db, selectedDate),
    listMealEntries(db, selectedDate),
    db.getFirstAsync<{ weight_trend_kg: number | null }>(
      `SELECT weight_trend_kg FROM daily_logs
       WHERE date <= ? AND weight_trend_kg IS NOT NULL
       ORDER BY date DESC LIMIT 1`,
      [addDays(selectedDate, -7)],
    ),
    getDaysRange(db, thirtyDaysFrom, today),
    getWorkoutDatesInRange(db, thirtyDaysFrom, today),
    getFoodLoggingStreak(db),
    getLoggedFoodDatesInRange(db, minStripDate, maxStripDate),
    listSupplementsForDate(db, selectedDate),
    listHabits(db),
    db.getAllAsync<{ habit_id: number; date: string }>(
      'SELECT habit_id, date FROM habit_logs WHERE date >= ? AND done = 1',
      [thirtyDaysFrom],
    ),
  ]);

  const weeklyChange =
    weightKg !== null && prevRow?.weight_trend_kg != null
      ? weightKg - prevRow.weight_trend_kg
      : null;

  // Compute Habit Matrix Data based on Current Calendar Week (Monday -> Sunday)
  const logsMap = new Map(logs30d.map((l) => [l.date, l]));
  const workoutDates = new Set(workoutDatesList);

  const weighInDays = thirtyDays.map((d) => logsMap.get(d)?.weight_kg != null);
  const weighInWeekCount = thirtyDays.filter((d, i) => currentWeekDays.has(d) && weighInDays[i]).length;

  const foodDays = thirtyDays.map((d) => {
    const l = logsMap.get(d);
    return l?.total_calories != null && l.total_calories > 0;
  });
  const foodWeekCount = thirtyDays.filter((d, i) => currentWeekDays.has(d) && foodDays[i]).length;

  const workoutDaysActive = thirtyDays.map((d) => workoutDates.has(d));
  const workoutWeekCount = thirtyDays.filter((d, i) => currentWeekDays.has(d) && workoutDaysActive[i]).length;

  const creatineDays = thirtyDays.map((d) => logsMap.get(d)?.creatine_taken === 1);
  const creatineWeekCount = thirtyDays.filter((d, i) => currentWeekDays.has(d) && creatineDays[i]).length;

  const builtinSummaries: Record<string, { activeDays: boolean[]; weekStat: string }> = {
    workout: { activeDays: workoutDaysActive, weekStat: `${workoutWeekCount}/5 this week` },
    food: { activeDays: foodDays, weekStat: `${foodWeekCount}/7 this week` },
    creatine: { activeDays: creatineDays, weekStat: `${creatineWeekCount}/7 this week` },
    weighIn: { activeDays: weighInDays, weekStat: `${weighInWeekCount}/7 this week` },
  };

  const habitLogMap = new Map<number, Set<string>>();
  for (const row of habitLogRows) {
    if (!habitLogMap.has(row.habit_id)) habitLogMap.set(row.habit_id, new Set());
    habitLogMap.get(row.habit_id)!.add(row.date);
  }

  const habitCards: HabitCardData[] = allHabits
    .filter((h) => !h.hidden)
    .map((h) => {
      if (h.builtin_key) {
        const summary =
          builtinSummaries[h.builtin_key] ?? { activeDays: thirtyDays.map(() => false), weekStat: '0/7 this week' };
        return {
          id: h.id,
          name: h.name,
          color: h.color,
          builtinKey: h.builtin_key,
          activeDays: summary.activeDays,
          weekStat: summary.weekStat,
          doneToday: false,
        };
      }
      const logSet = habitLogMap.get(h.id) ?? new Set<string>();
      const activeDays = thirtyDays.map((d) => logSet.has(d));
      const weekCount = thirtyDays.filter((d, i) => currentWeekDays.has(d) && activeDays[i]).length;
      return {
        id: h.id,
        name: h.name,
        color: h.color,
        builtinKey: null,
        activeDays,
        weekStat: `${weekCount}/7 this week`,
        doneToday: logSet.has(today),
      };
    });

  return {
    day,
    entries,
    groups: entriesByMeal(entries),
    settings,
    target,
    proteinTarget: macros.protein,
    carbsTarget: macros.carbs,
    fatTarget: macros.fat,
    trendWeight: weightKg,
    weeklyChange,
    habitCards,
    allHabits,
    streak,
    loggedDates,
    supplements,
  };
}

export default function TodayScreen() {
  const db = useDb();
  const [selectedDate, setSelectedDate] = useState<string>(todayISO());
  const [data, setData] = useState<DayScreenData | null>(null);
  const [weightStr, setWeightStr] = useState('');
  const [dashboardMode, setDashboardMode] = useState<'ring' | 'breakdown'>('ring');

  // Supplement Modal state (Add / Edit)
  const [suppModalVisible, setSuppModalVisible] = useState(false);
  const [editingSupp, setEditingSupp] = useState<SupplementWithLog | null>(null);
  const [suppName, setSuppName] = useState('');
  const [suppDosage, setSuppDosage] = useState('');
  const [suppDesc, setSuppDesc] = useState('');

  // Habits Management Modal state
  const [habitsModalVisible, setHabitsModalVisible] = useState(false);
  const [newHabitName, setNewHabitName] = useState('');
  const [newHabitColor, setNewHabitColor] = useState<string>(HABIT_COLORS[0]);
  const [colorPickerHabitId, setColorPickerHabitId] = useState<number | null>(null);

  // Delete Food Entry Confirm Modal state
  const [deleteTargetEntry, setDeleteTargetEntry] = useState<MealEntry | null>(null);

  const applyData = (d: DayScreenData) => {
    setData(d);
    const raw = d.day?.weight_kg;
    setWeightStr(raw !== null && raw !== undefined ? String(round(raw, 1)) : '');
  };

  const refreshData = useCallback(
    async (date: string) => {
      const d = await loadDayData(db, date);
      applyData(d);
    },
    [db],
  );

  useFocusEffect(
    useCallback(() => {
      let live = true;
      loadDayData(db, selectedDate).then((d) => {
        if (live) applyData(d);
      });
      return () => {
        live = false;
      };
    }, [db, selectedDate]),
  );

  if (!data) {
    return <Screen title="Today" loading />;
  }

  const consumed = data.day?.total_calories ?? 0;
  const target = data.target.calories;
  const remaining = target - consumed;
  const progress = target > 0 ? consumed / target : 0;
  const creatineOn = data.day?.creatine_taken === 1;

  const onSelectDate = (newDate: string) => {
    setSelectedDate(newDate);
    refreshData(newDate);
  };

  const onSaveWeight = async (overrideKg?: number) => {
    const kg = overrideKg ?? parseNumber(weightStr);
    if (kg === null || kg < 20 || kg > 300) {
      Alert.alert('Invalid weight', 'Enter your weight in kilograms (e.g. 77.5).');
      return;
    }
    await saveWeight(db, selectedDate, kg);
    await recalculateAll(db);
    applyData(await loadDayData(db, selectedDate));
  };

  const onToggleSupplement = async (supp: SupplementWithLog) => {
    const nextTaken = !supp.taken;
    await toggleSupplementLog(db, supp.id, selectedDate, nextTaken);
    // Keep legacy creatine column synchronized for streak/habits if it's creatine
    if (supp.name.toLowerCase().includes('creatine')) {
      await setCreatine(db, selectedDate, nextTaken);
    }
    applyData(await loadDayData(db, selectedDate));
  };

  const openAddSupplement = () => {
    setEditingSupp(null);
    setSuppName('');
    setSuppDosage('');
    setSuppDesc('');
    setSuppModalVisible(true);
  };

  const openEditSupplement = (supp: SupplementWithLog) => {
    setEditingSupp(supp);
    setSuppName(supp.name);
    setSuppDosage(supp.dosage);
    setSuppDesc(supp.description);
    setSuppModalVisible(true);
  };

  const saveSupplement = async () => {
    if (!suppName.trim()) {
      Alert.alert('Missing name', 'Please enter a supplement name.');
      return;
    }
    if (editingSupp) {
      await updateSupplement(db, editingSupp.id, suppName, suppDosage, suppDesc);
    } else {
      await addSupplement(db, suppName, suppDosage, suppDesc);
    }
    setSuppModalVisible(false);
    applyData(await loadDayData(db, selectedDate));
  };

  const removeSupplement = async () => {
    if (!editingSupp) return;
    const confirmMsg = `Delete "${editingSupp.name}" supplement?`;
    if (Platform.OS === 'web') {
      if (window.confirm(confirmMsg)) {
        await deleteSupplement(db, editingSupp.id);
        setSuppModalVisible(false);
        applyData(await loadDayData(db, selectedDate));
      }
      return;
    }
    Alert.alert('Delete Supplement?', confirmMsg, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteSupplement(db, editingSupp.id);
          setSuppModalVisible(false);
          applyData(await loadDayData(db, selectedDate));
        },
      },
    ]);
  };

  const onDeleteEntry = (entry: MealEntry) => {
    setDeleteTargetEntry(entry);
  };

  const handleConfirmDeleteEntry = async () => {
    if (!deleteTargetEntry) return;
    const entry = deleteTargetEntry;
    setDeleteTargetEntry(null);
    await deleteMealEntry(db, entry.id);
    await recalculateAll(db);
    applyData(await loadDayData(db, selectedDate));
  };

  const tdeeDisplay =
    data.target.tdee !== null ? fmtInt(data.target.tdee) : `~${fmtInt(data.target.estimatedTdee)}`;
  const confidenceText =
    data.target.status === 'CALIBRATING'
      ? `Calibrating (${data.target.calibrationProgress}/21d)`
      : data.target.confidence === 'high'
        ? 'High Confidence'
        : 'Active Adaptive';

  const handleAcceptCheckIn = async (newCal: number) => {
    await acceptWeeklyCheckInAdjustment(db, newCal);
    await recalculateAll(db);
    applyData(await loadDayData(db, selectedDate));
  };

  const handleDeferCheckIn = async () => {
    await deferWeeklyCheckIn(db);
    applyData(await loadDayData(db, selectedDate));
  };

  const openManageHabits = () => {
    setNewHabitName('');
    setNewHabitColor(HABIT_COLORS[0]);
    setColorPickerHabitId(null);
    setHabitsModalVisible(true);
  };

  const toggleCustomHabit = async (h: HabitCardData) => {
    await toggleHabitLog(db, h.id, selectedDate, !h.doneToday);
    applyData(await loadDayData(db, selectedDate));
  };

  const handleAddHabit = async () => {
    if (!newHabitName.trim()) return;
    await createHabit(db, newHabitName, newHabitColor);
    setNewHabitName('');
    setNewHabitColor(HABIT_COLORS[0]);
    applyData(await loadDayData(db, selectedDate));
  };

  const handleToggleHabitHidden = async (h: HabitRow) => {
    await setHabitHidden(db, h.id, !h.hidden);
    applyData(await loadDayData(db, selectedDate));
  };

  const handleDeleteHabit = async (h: HabitRow) => {
    const confirmMsg = `Delete "${h.name}" habit? Its history will be removed.`;
    if (Platform.OS === 'web') {
      if (window.confirm(confirmMsg)) {
        await deleteCustomHabit(db, h.id);
        applyData(await loadDayData(db, selectedDate));
      }
      return;
    }
    Alert.alert('Delete Habit?', confirmMsg, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteCustomHabit(db, h.id);
          applyData(await loadDayData(db, selectedDate));
        },
      },
    ]);
  };

  const handlePickHabitColor = async (habitId: number, color: string) => {
    await setHabitColor(db, habitId, color);
    setColorPickerHabitId(null);
    applyData(await loadDayData(db, selectedDate));
  };

  return (
    <Screen
      customHeader={
        <WeekCalendarStrip
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          loggedDates={data.loggedDates}
          streak={data.streak}
          phase={data.settings.phase}
        />
      }
    >
      {/* 1. HERO NUTRITION / CALORIE & MACRO CARD */}
      <Card highlight style={{ padding: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="flame" size={16} color={C.kcal} />
            <Txt size="xs" weight="800" color={C.dimmer} style={{ letterSpacing: 1.2 }}>
              DAILY NUTRITION
            </Txt>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={st.statusPill}>
              <Txt size="xs" weight="700" color={data.target.status === 'CALIBRATING' ? C.warn : data.target.source === 'adaptive' ? C.accent : C.blue}>
                {data.target.status === 'CALIBRATING'
                  ? '⚙ Calibrating'
                  : data.target.source === 'adaptive'
                    ? '⚡ Adaptive Target'
                    : '⚙ Baseline Estimate'}
              </Txt>
            </View>

            {/* Double-Arrow Switch Button on top right header row */}
            <Pressable
              onPress={() =>
                setDashboardMode((m) => (m === 'ring' ? 'breakdown' : 'ring'))
              }
              hitSlop={8}
              style={({ pressed }) => [
                st.switchModeBtn,
                pressed && { opacity: 0.7, backgroundColor: C.surfaceAlt },
              ]}
            >
              <Ionicons
                name="swap-horizontal"
                size={14}
                color={dashboardMode === 'breakdown' ? C.accent : C.dim}
              />
            </Pressable>
          </View>
        </View>

        {/* Layout: Calorie Ring on Left, 3 Macro Bars on Right - perfectly aligned */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          {/* Calorie Ring */}
          <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            <Ring
              progress={progress}
              size={130}
              stroke={12}
              color={remaining < 0 ? C.warn : C.kcal}
              trackColor={C.surfaceHi}
            >
              <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                <Txt size="xxl" weight="900" color={remaining < 0 ? C.warn : C.text} style={{ letterSpacing: -1 }}>
                  {remaining >= 0 ? fmtInt(remaining) : `+${fmtInt(-remaining)}`}
                </Txt>
                <Txt size="xs" weight="700" color={C.dim} style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {remaining >= 0 ? 'kcal left' : 'over budget'}
                </Txt>
              </View>
            </Ring>
            <Txt size="xs" color={C.dimmer} weight="600" style={{ marginTop: 6 }}>
              {`${fmtInt(consumed)} / ${fmtInt(target)} kcal`}
            </Txt>
          </View>

          {/* 3 Macro Bars Column vertically centered */}
          <View style={{ flex: 1, gap: 10, justifyContent: 'center' }}>
            <MacroBar
              label="Protein"
              value={data.day?.protein_g ?? 0}
              target={data.proteinTarget}
              color={C.protein}
              mode={dashboardMode === 'breakdown' ? 'left' : 'consumed'}
            />
            <MacroBar
              label="Carbs"
              value={data.day?.carbs_g ?? 0}
              target={data.carbsTarget}
              color={C.carbs}
              mode={dashboardMode === 'breakdown' ? 'left' : 'consumed'}
            />
            <MacroBar
              label="Fat"
              value={data.day?.fats_g ?? 0}
              target={data.fatTarget}
              color={C.fat}
              mode={dashboardMode === 'breakdown' ? 'left' : 'consumed'}
            />
          </View>
        </View>
      </Card>

      {/* 2. SUPPLEMENTS SECTION (CUSTOMIZABLE, EDIT & ADD) */}
      <View style={{ gap: 8, marginTop: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="flash" size={15} color={C.accent} />
            <Txt size="md" weight="800" style={{ letterSpacing: -0.3 }}>
              SUPPLEMENTS
            </Txt>
          </View>
          <Pressable
            onPress={openAddSupplement}
            style={({ pressed }) => [st.addSuppHeaderBtn, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="add" size={15} color={C.accent} />
            <Txt size="xs" weight="800" color={C.accent}>
              Add Supplement
            </Txt>
          </Pressable>
        </View>

        {data.supplements && data.supplements.length > 0 ? (
          <View style={{ gap: 8 }}>
            {data.supplements.map((supp) => (
              <Pressable
                key={supp.id}
                onPress={() => onToggleSupplement(supp)}
                style={[
                  st.creatineCard,
                  supp.taken && { borderColor: C.accent, backgroundColor: C.surfaceHi },
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <View style={[st.creatineIcon, supp.taken && { backgroundColor: C.accent }]}>
                    <Ionicons
                      name="flash"
                      size={16}
                      color={supp.taken ? C.onAccent : C.accent}
                    />
                  </View>
                  <View style={{ gap: 2, flex: 1 }}>
                    <Txt size="sm" weight="700">
                      {`${supp.name}${supp.dosage ? ` · ${supp.dosage}` : ''}`}
                    </Txt>
                    <Txt size="xs" color={C.dimmer} weight="500">
                      {supp.taken
                        ? supp.description || 'Taken for today'
                        : supp.description || 'Daily habit · Tap to mark taken'}
                    </Txt>
                  </View>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Chip
                    label={supp.taken ? '✓ Taken' : 'Mark Taken'}
                    active={supp.taken}
                    small
                    onPress={() => onToggleSupplement(supp)}
                  />
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation?.();
                      openEditSupplement(supp);
                    }}
                    hitSlop={8}
                    style={st.suppEditIconBtn}
                  >
                    <Ionicons name="ellipsis-vertical" size={15} color={C.dim} />
                  </Pressable>
                </View>
              </Pressable>
            ))}
          </View>
        ) : (
          <Pressable onPress={openAddSupplement} style={st.emptySuppSlot}>
            <Txt size="xs" weight="600" color={C.dimmer}>
              + Add your daily supplements (Creatine, Vitamins, etc.)
            </Txt>
          </Pressable>
        )}
      </View>

      {/* 3. HABITS TRACKER CARDS (30-DAY HEATMAPS) */}
      <View style={{ gap: 8, marginTop: 2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 }}>
          <Pressable
            onPress={openManageHabits}
            style={({ pressed }) => [st.habitsHeaderBtn, pressed && { opacity: 0.7 }]}
          >
            <Txt size="md" weight="800" style={{ letterSpacing: -0.3 }}>
              Habits
            </Txt>
            <Ionicons name="settings-outline" size={14} color={C.dimmer} />
          </Pressable>
          <Chip
            label="Calendar View ›"
            active
            small
            onPress={() =>
              router.push({ pathname: '/habit-detail' as any, params: { habit: 'food' } })
            }
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 10, paddingRight: 6 }}
        >
          {data.habitCards.map((h) => (
            <HabitCard
              key={h.id}
              title={h.name}
              activeDays={h.activeDays}
              color={h.color}
              weekStat={h.doneToday ? `✓ ${h.weekStat}` : h.weekStat}
              onPress={() =>
                h.builtinKey
                  ? router.push({ pathname: '/habit-detail' as any, params: { habit: h.builtinKey } })
                  : toggleCustomHabit(h)
              }
            />
          ))}
          <Pressable onPress={openManageHabits} style={st.addHabitCard}>
            <Ionicons name="add-circle-outline" size={24} color={C.dim} />
            <Txt size="xs" weight="700" color={C.dimmer} align="center">
              New Habit
            </Txt>
          </Pressable>
        </ScrollView>
      </View>

      {/* 4. DYNAMIC EXPENDITURE SNAPSHOT */}
      <Card>
        <CardTitle icon={<Ionicons name="speedometer-outline" size={15} color={C.blue} />}>
          ENERGY EXPENDITURE
        </CardTitle>

        <View style={st.tdeeHero}>
          <View style={{ flex: 1 }}>
            <Txt size="xs" weight="700" color={C.dimmer} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
              Calculated TDEE
            </Txt>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
              <Txt size="xxl" weight="900" color={C.blue}>
                {tdeeDisplay}
              </Txt>
              <Txt size="sm" weight="700" color={C.dim}>
                kcal / day
              </Txt>
            </View>
            <Txt size="xs" color={C.dim} weight="600" style={{ marginTop: 2 }}>
              {data.target.status === 'CALIBRATING'
                ? 'Dynamic Energy Burn · refined as you log'
                : 'Dynamic Energy Burn · locked to your data'}
            </Txt>
          </View>
          <View style={st.tdeeFlame}>
            <Ionicons name="flame" size={22} color={C.blue} />
          </View>
        </View>

        {data.target.status === 'CALIBRATING' ? (
          <View style={st.calibBox}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="cog" size={13} color={C.warn} />
                <Txt size="xs" weight="800" color={C.warn} style={{ letterSpacing: 0.8 }}>
                  ENGINE CALIBRATING
                </Txt>
              </View>
              <Txt size="xs" weight="800" color={C.warn}>
                {`${data.target.calibrationProgress}/21 days`}
              </Txt>
            </View>
            <View style={st.calibTrack}>
              <View
                style={[
                  st.calibFill,
                  {
                    width: `${Math.min(100, Math.max(2, Math.round((data.target.calibrationProgress / 21) * 100)))}%`,
                  },
                ]}
              />
            </View>
            <Txt size="xs" color={C.dim} weight="600">
              {`21-Day Lock Active · ${Math.max(0, 21 - data.target.calibrationProgress)} days until adaptive mode`}
            </Txt>
          </View>
        ) : (
          <View style={st.activeBox}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="flash" size={13} color={C.accent} />
              <Txt size="xs" weight="800" color={C.accent} style={{ letterSpacing: 0.8 }}>
                {confidenceText}
              </Txt>
            </View>
            <Txt size="xs" color={C.dim} weight="600" style={{ flex: 1, textAlign: 'right' }}>
              Adaptive engine tracking your real-world burn
            </Txt>
          </View>
        )}

        {/* Weekly Check-In Recommendation Banner (Day 22+) */}
        {data.target.pendingCheckIn && data.target.pendingCheckIn.eligible ? (
          <View style={{ marginTop: 10, padding: 12, backgroundColor: '#0B1F17', borderRadius: 12, borderWidth: 1, borderColor: C.accent }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Ionicons name="sparkles" size={16} color={C.accent} />
              <Txt size="sm" weight="900" color={C.accent}>
                Weekly Check-In Ready
              </Txt>
            </View>
            <Txt size="xs" color={C.text} style={{ lineHeight: 18, marginBottom: 8 }}>
              {data.target.pendingCheckIn.message}
            </Txt>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.surface, padding: 10, borderRadius: 8, marginBottom: 10 }}>
              <View>
                <Txt size="xs" color={C.dimmer} weight="700">CURRENT TARGET</Txt>
                <Txt size="md" weight="900" color={C.text}>{data.target.pendingCheckIn.currentCalories} kcal</Txt>
              </View>
              <Ionicons name="arrow-forward" size={16} color={C.dim} />
              <View>
                <Txt size="xs" color={C.accent} weight="700">NEW PROPOSAL</Txt>
                <Txt size="md" weight="900" color={C.accent}>{data.target.pendingCheckIn.recommendedCalories} kcal</Txt>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                title="Accept Adjustment"
                small
                onPress={() => handleAcceptCheckIn(data.target.pendingCheckIn!.recommendedCalories)}
              />
              <Button
                title="Keep Current"
                variant="secondary"
                small
                onPress={handleDeferCheckIn}
              />
            </View>
          </View>
        ) : null}
      </Card>

      {/* 5. MACROFACTOR DAILY MEAL TIMELINE */}
      <View style={{ gap: 10, marginTop: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 }}>
          <Txt size="md" weight="800" style={{ letterSpacing: -0.3 }}>
            FOOD LOG
          </Txt>
          <Txt size="xs" weight="700" color={C.dimmer}>
            {`${data.entries.length} ITEMS LOGGED`}
          </Txt>
        </View>

        {ALL_MEAL_TYPES.map((mealType) => {
          const group = data.groups.find((g) => g.type === mealType);
          const mealCalories = group
            ? group.items.reduce((sum, item) => sum + item.calories, 0)
            : 0;
          const mealProtein = group
            ? group.items.reduce((sum, item) => sum + item.protein, 0)
            : 0;
          const mealCarbs = group
            ? group.items.reduce((sum, item) => sum + item.carbs, 0)
            : 0;
          const mealFat = group
            ? group.items.reduce((sum, item) => sum + item.fat, 0)
            : 0;

          return (
            <Card key={mealType} style={{ padding: 14 }}>
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/meal-detail' as any,
                    params: { mealType, date: selectedDate },
                  })
                }
                style={({ pressed }) => [
                  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons
                    name={
                      mealType === 'Breakfast'
                        ? 'sunny-outline'
                        : mealType === 'Lunch'
                          ? 'restaurant-outline'
                          : mealType === 'Dinner'
                            ? 'moon-outline'
                            : 'cafe-outline'
                    }
                    size={16}
                    color={C.dim}
                  />
                  <Txt size="md" weight="800">
                    {mealType}
                  </Txt>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {mealCalories > 0 ? (
                    <Txt size="sm" weight="800" color={C.kcal}>
                      {`${fmtInt(mealCalories)} kcal`}
                    </Txt>
                  ) : null}
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation?.();
                      router.push({
                        pathname: '/log-food' as any,
                        params: { mealType, date: selectedDate },
                      });
                    }}
                    style={st.mealAddButton}
                  >
                    <Txt size="xs" weight="800" color={C.text}>
                      Log
                    </Txt>
                  </Pressable>
                </View>
              </Pressable>

              {group && group.items.length > 0 ? (
                <View style={{ gap: 6, marginTop: 4 }}>
                  {/* Macro subtotal summary for the meal */}
                  <View style={st.mealMacroSummary}>
                    <Txt size="xs" weight="700" color={C.protein}>
                      {`P: ${fmtInt(mealProtein)}g`}
                    </Txt>
                    <Txt size="xs" color={C.dimmer}>•</Txt>
                    <Txt size="xs" weight="700" color={C.carbs}>
                      {`C: ${fmtInt(mealCarbs)}g`}
                    </Txt>
                    <Txt size="xs" color={C.dimmer}>•</Txt>
                    <Txt size="xs" weight="700" color={C.fat}>
                      {`F: ${fmtInt(mealFat)}g`}
                    </Txt>
                  </View>

                  <Divider />

                  {group.items.map((item) => (
                    <View key={item.id} style={st.foodRowContainer}>
                      <Pressable
                        onPress={() =>
                          router.push({ pathname: '/add-entry', params: { entryId: String(item.id) } })
                        }
                        onLongPress={() => onDeleteEntry(item)}
                        style={({ pressed }) => [st.foodItemRow, pressed && { opacity: 0.7 }]}
                      >
                        <View style={{ flex: 1, gap: 2 }}>
                          <Txt size="sm" weight="700" color={C.text}>
                            {item.food_name}
                          </Txt>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            {item.serving_grams !== null ? (
                              <View style={st.gramBadge}>
                                <Txt size="xs" weight="700" color={C.accent}>
                                  {`${fmtNum(item.serving_grams)}g`}
                                </Txt>
                              </View>
                            ) : null}
                            <Txt size="xs" color={C.dim}>
                              {`${fmtInt(item.protein)}P  ${fmtInt(item.carbs)}C  ${fmtInt(item.fat)}F`}
                            </Txt>
                          </View>
                        </View>

                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <Txt size="sm" weight="800" color={C.kcal}>
                            {`${fmtInt(item.calories)} kcal`}
                          </Txt>
                          <Pressable
                            onPress={(e) => {
                              e.stopPropagation?.();
                              onDeleteEntry(item);
                            }}
                            hitSlop={8}
                            style={({ pressed }) => [
                              st.trashBtn,
                              pressed && { backgroundColor: C.surfaceHi, opacity: 0.7 },
                            ]}
                          >
                            <Ionicons name="trash-outline" size={14} color={C.dimmer} />
                          </Pressable>
                        </View>
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : (
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/log-food' as any,
                      params: { mealType, date: selectedDate },
                    })
                  }
                  style={st.emptyMealSlot}
                >
                  <Txt size="xs" weight="600" color={C.dimmer}>
                    {`+ Add food to ${mealType}`}
                  </Txt>
                </Pressable>
              )}
            </Card>
          );
        })}
      </View>

      {/* Primary Floating/Docked Add Food Action */}
      <Button
        title="+ Log Food (Gram-Accurate)"
        onPress={() =>
          router.push({
            pathname: '/log-food' as any,
            params: { mealType: guessMealType(), date: selectedDate },
          })
        }
      />

      {/* 6. BODY WEIGHT & SCALE INPUT (MOVED DOWN BELOW FOOD LOG) */}
      <Card style={{ marginTop: 6 }}>
        <CardTitle icon={<Ionicons name="scale-outline" size={15} color={C.weight} />}>
          BODY WEIGHT & TREND
        </CardTitle>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginVertical: 4 }}>
          <View style={{ gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <Txt size="hero" weight="900" color={C.weight} style={{ letterSpacing: -1 }}>
                {data.trendWeight !== null ? fmtNum(data.trendWeight) : '—'}
              </Txt>
              <Txt size="md" weight="700" color={C.dim}>
                kg trend
              </Txt>
            </View>
            {data.day?.weight_kg != null ? (
              <Txt size="xs" color={C.dimmer} weight="600">
                {`Scale: ${fmtNum(data.day.weight_kg)} kg`}
              </Txt>
            ) : (
              <Txt size="xs" color={C.dimmer} weight="500">
                Scale weight not logged today
              </Txt>
            )}
          </View>

          {data.weeklyChange !== null ? (
            <View style={[st.velocityBadge, { backgroundColor: data.weeklyChange <= 0 ? C.accentSoft : C.warn + '20' }]}>
              <Ionicons
                name={data.weeklyChange <= 0 ? 'arrow-down' : 'arrow-up'}
                size={13}
                color={data.weeklyChange <= 0 ? C.accent : C.warn}
              />
              <Txt size="xs" weight="800" color={data.weeklyChange <= 0 ? C.accent : C.warn}>
                {`${fmtSigned(data.weeklyChange)} kg/wk`}
              </Txt>
            </View>
          ) : null}
        </View>

        {/* Log Scale Weight Input Row */}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <NumberField
            label=""
            value={weightStr}
            onChangeText={setWeightStr}
            suffix="kg"
            placeholder={data.trendWeight ? String(fmtNum(data.trendWeight)) : '77.5'}
            style={{ flex: 1, margin: 0 }}
          />
          <Button title="Save" small onPress={() => onSaveWeight()} />
        </View>

        {data.day?.notes ? (
          <Txt size="xs" color={C.dim} style={{ fontStyle: 'italic', marginTop: 4 }}>
            {data.day.notes}
          </Txt>
        ) : null}
      </Card>

      {/* 7. SUPPLEMENT ADD / EDIT MODAL */}
      <Modal
        visible={suppModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSuppModalVisible(false)}
      >
        <Pressable
          style={st.suppModalBackdrop}
          onPress={() => setSuppModalVisible(false)}
        >
          <Pressable style={st.suppModalSheet} onPress={(e) => e.stopPropagation?.()}>
            <View style={st.suppModalHeader}>
              <Txt size="lg" weight="800">
                {editingSupp ? 'Edit Supplement' : 'Add Supplement'}
              </Txt>
              <Pressable
                onPress={() => setSuppModalVisible(false)}
                hitSlop={8}
                style={({ pressed }) => pressed && { opacity: 0.6 }}
              >
                <Ionicons name="close" size={20} color={C.dim} />
              </Pressable>
            </View>

            <View style={{ gap: 12 }}>
              <View style={{ gap: 4 }}>
                <Txt size="xs" weight="700" color={C.dim}>
                  NAME *
                </Txt>
                <TextInput
                  value={suppName}
                  onChangeText={setSuppName}
                  placeholder="e.g. Creatine Monohydrate, Fish Oil, Zinc"
                  placeholderTextColor={C.dimmer}
                  style={st.suppInput}
                />
              </View>

              <View style={{ gap: 4 }}>
                <Txt size="xs" weight="700" color={C.dim}>
                  DOSAGE / SERVING
                </Txt>
                <TextInput
                  value={suppDosage}
                  onChangeText={setSuppDosage}
                  placeholder="e.g. 5g, 1000mg, 2 capsules"
                  placeholderTextColor={C.dimmer}
                  style={st.suppInput}
                />
              </View>

              <View style={{ gap: 4 }}>
                <Txt size="xs" weight="700" color={C.dim}>
                  DESCRIPTION / NOTES (OPTIONAL)
                </Txt>
                <TextInput
                  value={suppDesc}
                  onChangeText={setSuppDesc}
                  placeholder="e.g. Daily morning with water"
                  placeholderTextColor={C.dimmer}
                  style={st.suppInput}
                />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              {editingSupp ? (
                <View style={{ flex: 1 }}>
                  <Button
                    title="Delete"
                    variant="danger"
                    onPress={removeSupplement}
                  />
                </View>
              ) : null}
              <View style={{ flex: editingSupp ? 2 : 1 }}>
                <Button
                  title={editingSupp ? 'Save Changes' : 'Add Supplement'}
                  onPress={saveSupplement}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Habits Management Modal */}
      <Modal
        visible={habitsModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setHabitsModalVisible(false)}
      >
        <Pressable style={st.suppModalBackdrop} onPress={() => setHabitsModalVisible(false)}>
          <Pressable style={st.suppModalSheet} onPress={(e) => e.stopPropagation?.()}>
            <View style={st.suppModalHeader}>
              <Txt size="lg" weight="900">
                Manage Habits
              </Txt>
              <Pressable onPress={() => setHabitsModalVisible(false)} style={st.closeHabitsBtn}>
                <Ionicons name="close" size={18} color={C.dim} />
              </Pressable>
            </View>

            {/* Add New Habit */}
            <View style={{ gap: 10 }}>
              <Txt size="xs" weight="700" color={C.dimmer} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
                Add New Habit
              </Txt>
              <TextInput
                placeholder="e.g. Stretching, Reading, Meditation"
                placeholderTextColor={C.dimmer}
                value={newHabitName}
                onChangeText={setNewHabitName}
                style={st.suppInput}
              />
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {HABIT_COLORS.map((color) => (
                  <Pressable
                    key={color}
                    onPress={() => setNewHabitColor(color)}
                    style={[st.habitSwatch, newHabitColor === color && st.habitSwatchSelected]}
                  >
                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: color }} />
                  </Pressable>
                ))}
              </View>
              <Button title="Add Habit" small onPress={handleAddHabit} disabled={!newHabitName.trim()} />
            </View>

            <Divider />

            {/* Existing Habits List */}
            <View style={{ gap: 8 }}>
              <Txt size="xs" weight="700" color={C.dimmer} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
                Your Habits
              </Txt>
              {data.allHabits.map((h) => (
                <View key={h.id}>
                  <View style={st.habitManageRow}>
                    <Pressable
                      onPress={() =>
                        setColorPickerHabitId(colorPickerHabitId === h.id ? null : h.id)
                      }
                      hitSlop={4}
                    >
                      <View style={[st.habitSwatchDot, { backgroundColor: h.color }]} />
                    </Pressable>
                    <View style={{ flex: 1, gap: 1 }}>
                      <Txt
                        size="sm"
                        weight="700"
                        color={h.hidden ? C.dimmer : C.text}
                        style={{ textDecorationLine: h.hidden ? 'line-through' : 'none' }}
                      >
                        {h.name}
                      </Txt>
                      <Txt size="xs" color={C.dimmer} weight="600">
                        {h.builtin_key ? 'Built-in' : 'Custom'} · tap colour to change
                      </Txt>
                    </View>
                    <Pressable onPress={() => handleToggleHabitHidden(h)} style={st.habitActionBtn} hitSlop={6}>
                      <Ionicons
                        name={h.hidden ? 'eye-off' : 'eye'}
                        size={17}
                        color={h.hidden ? C.dimmer : C.blue}
                      />
                    </Pressable>
                    {!h.builtin_key ? (
                      <Pressable onPress={() => handleDeleteHabit(h)} style={st.habitActionBtn} hitSlop={6}>
                        <Ionicons name="trash-outline" size={16} color={C.danger} />
                      </Pressable>
                    ) : null}
                  </View>

                  {colorPickerHabitId === h.id ? (
                    <View style={st.habitPaletteRow}>
                      {HABIT_COLORS.map((color) => (
                        <Pressable
                          key={color}
                          onPress={() => handlePickHabitColor(h.id, color)}
                          style={[st.habitSwatch, h.color === color && st.habitSwatchSelected]}
                        >
                          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: color }} />
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Delete Food Entry Confirmation Modal */}
      <ConfirmModal
        visible={Boolean(deleteTargetEntry)}
        title="Delete Food Entry?"
        message={`Are you sure you want to delete "${deleteTargetEntry?.food_name}" from your food log?`}
        confirmText="Delete"
        cancelText="Cancel"
        danger
        onConfirm={handleConfirmDeleteEntry}
        onCancel={() => setDeleteTargetEntry(null)}
      />
    </Screen>
  );
}

const st = StyleSheet.create({
  phaseBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.accent + '40',
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.accent,
  },
  statusPill: {
    backgroundColor: C.surfaceHi,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  velocityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  creatineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surfaceAlt,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  creatineIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: C.surfaceHi,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  mealMacroSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 2,
  },
  foodItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    flex: 1,
  },
  foodRowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trashBtn: {
    padding: 6,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gramBadge: {
    backgroundColor: C.accentSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  emptyMealSlot: {
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  addSuppHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: C.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.accent + '35',
  },
  suppEditIconBtn: {
    padding: 6,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySuppSlot: {
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suppModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  suppModalSheet: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: C.border,
    gap: 16,
  },
  suppModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  suppInput: {
    backgroundColor: C.surfaceHi,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.text,
    fontSize: 14,
  },
  switchModeBtn: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: C.surfaceHi,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tdeeHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.blueSoft,
    borderWidth: 1,
    borderColor: C.blue + '33',
    borderRadius: 14,
    padding: 12,
  },
  tdeeFlame: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.blue + '1F',
    borderWidth: 1,
    borderColor: C.blue + '33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calibBox: {
    gap: 8,
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderWidth: 1,
    borderColor: C.warn + '33',
    borderRadius: 14,
    padding: 12,
  },
  calibTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: C.surfaceHi,
    overflow: 'hidden',
  },
  calibFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: C.warn,
  },
  activeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: C.accentSoft,
    borderWidth: 1,
    borderColor: C.accent + '33',
    borderRadius: 14,
    padding: 12,
  },
  habitsHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  addHabitCard: {
    width: 110,
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 16,
  },
  closeHabitsBtn: {
    padding: 6,
    borderRadius: 12,
    backgroundColor: C.surfaceAlt,
  },
  habitSwatch: {
    padding: 4,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  habitSwatchSelected: {
    borderColor: C.text,
  },
  habitSwatchDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: C.borderLight,
  },
  habitManageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.surfaceAlt,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  habitActionBtn: {
    padding: 6,
    borderRadius: 8,
  },
  habitPaletteRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
    padding: 8,
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
});
