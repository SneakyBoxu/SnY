import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { C } from '@/constants/theme';
import { formatDayLabel, todayISO } from '@/lib/date';
import { fmtInt, fmtNum } from '@/lib/num';
import type { WorkoutDaySummary, WorkoutEntry } from '@/lib/types';
import { getSession } from '@/lib/workoutSession';
import { useDb } from '@/db/db';
import {
  addTemplateExercise,
  countWorkoutDays,
  deleteRoutine,
  deleteWorkoutEntry,
  exerciseHistory,
  focusLabel,
  getAllRoutinesData,
  listWorkoutEntries,
  recentWorkoutDays,
  removeTemplateExercise,
  RoutineCardData,
  setCustomFocusLabel,
  suggestedFocusKey,
  topExercisesForFocus,
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
  Button,
  Card,
  CardTitle,
  Chip,
  ChipRow,
  ConfirmModal,
  Divider,
  EmptyHint,
  NumberField,
  Screen,
  Txt,
} from '@/components/ui';

function getExerciseCategoryIcon(name: string): { icon: keyof typeof Ionicons.glyphMap; color: string; bg: string } {
  const lower = name.toLowerCase();
  if (lower.includes('bench press') || lower.includes('chest') || lower.includes('incline') || lower.includes('dip') || lower.includes('fly')) {
    return { icon: 'barbell', color: '#38BDF8', bg: 'rgba(56,189,248,0.15)' };
  }
  if (lower.includes('squat') || lower.includes('leg') || lower.includes('calf') || lower.includes('lunge') || lower.includes('quad') || lower.includes('hamstring')) {
    return { icon: 'body', color: '#10B981', bg: 'rgba(16,185,129,0.15)' };
  }
  if (lower.includes('deadlift') || lower.includes('row') || lower.includes('pull-up') || lower.includes('lat') || lower.includes('back') || lower.includes('hang')) {
    return { icon: 'fitness', color: '#A855F7', bg: 'rgba(168,85,247,0.15)' };
  }
  if (lower.includes('tricep') || lower.includes('bicep') || lower.includes('curl') || lower.includes('arm') || lower.includes('shoulder') || lower.includes('raise') || lower.includes('press')) {
    return { icon: 'barbell', color: '#FBBF24', bg: 'rgba(251,191,36,0.15)' };
  }
  return { icon: 'walk', color: '#2DD4BF', bg: 'rgba(45,212,191,0.15)' };
}

export default function WorkoutScreen() {
  const db = useDb();
  const [todayEntries, setTodayEntries] = useState<WorkoutEntry[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>('push');
  const [routinesList, setRoutinesList] = useState<RoutineCardData[]>([]);
  const [expandedRoutineKeys, setExpandedRoutineKeys] = useState<string[]>([]);
  const [recent, setRecent] = useState<WorkoutDaySummary[]>([]);
  const [focusExercises, setFocusExercises] = useState<string[]>([]);
  const [totalSessions, setTotalSessions] = useState(0);
  const [progressExercise, setProgressExercise] = useState<string | null>(null);
  const [progressData, setProgressData] = useState<WorkoutEntry[] | null>(null);

  // Section collapse state
  const [isRoutinesSectionCollapsed, setIsRoutinesSectionCollapsed] = useState(false);
  const [showRoutineDropdownModal, setShowRoutineDropdownModal] = useState(false);

  // Routine Edit Modal State
  const [editingRoutine, setEditingRoutine] = useState<RoutineCardData | null>(null);
  const [editRoutineNameInput, setEditRoutineNameInput] = useState('');
  const [newExerciseInput, setNewExerciseInput] = useState('');
  const [showAddExerciseBox, setShowAddExerciseBox] = useState(false);
  const [routineSavedMsg, setRoutineSavedMsg] = useState<string | null>(null);
  const [deleteRoutineTarget, setDeleteRoutineTarget] = useState<RoutineCardData | null>(null);

  const today = todayISO();

  const loadData = useCallback(async () => {
    const [entries, suggested, rec, count, allRoutines] = await Promise.all([
      listWorkoutEntries(db, today),
      suggestedFocusKey(db),
      recentWorkoutDays(db, 8),
      countWorkoutDays(db),
      getAllRoutinesData(db),
    ]);
    setTodayEntries(entries);
    setSelectedKey((prev) => prev || suggested || 'push');
    setRecent(rec);
    setTotalSessions(count);
    setRoutinesList(allRoutines);
  }, [db, today]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  // Load analytics scoped strictly to the active selected routine day
  useEffect(() => {
    if (!selectedKey) return;
    let live = true;
    (async () => {
      const exercisesForDay = await topExercisesForFocus(db, selectedKey);
      if (live) {
        setFocusExercises(exercisesForDay);
        setProgressExercise((prev) => {
          if (prev && exercisesForDay.includes(prev)) return prev;
          return exercisesForDay[0] ?? null;
        });
      }
    })();
    return () => {
      live = false;
    };
  }, [db, selectedKey]);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!progressExercise) {
        if (live) setProgressData(null);
        return;
      }
      const rows = await exerciseHistory(db, progressExercise);
      if (live) setProgressData(rows);
    })();
    return () => {
      live = false;
    };
  }, [db, progressExercise]);

  if (todayEntries === null) {
    return <Screen title="Workout" loading />;
  }

  const toggleExpandRoutine = (key: string) => {
    setExpandedRoutineKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const handleStartRoutine = (routine: RoutineCardData) => {
    const active = getSession();
    if (active) {
      router.push({
        pathname: '/active-workout' as any,
        params: { date: active.date, focusKey: active.focusKey },
      });
      return;
    }
    setSelectedKey(routine.focusKey);
    router.push({
      pathname: '/active-workout' as any,
      params: {
        date: today,
        focusKey: routine.focusKey,
      },
    });
  };

  const openEditRoutineModal = (routine: RoutineCardData) => {
    setEditingRoutine(routine);
    setEditRoutineNameInput(routine.name);
    setShowAddExerciseBox(false);
    setNewExerciseInput('');
    setRoutineSavedMsg(null);
  };

  const handleSaveRoutineTitle = async () => {
    if (!editingRoutine || !editRoutineNameInput.trim()) return;
    const cleanName = editRoutineNameInput.trim();
    if (editingRoutine.focusKey.startsWith('custom_')) {
      const routineId = Number(editingRoutine.focusKey.replace('custom_', ''));
      await db.runAsync('UPDATE routines SET name = ? WHERE id = ?', [cleanName, routineId]);
    } else {
      await setCustomFocusLabel(db, editingRoutine.focusKey, cleanName);
    }
    await loadData();
    setRoutineSavedMsg('✓ Routine name saved!');
    setTimeout(() => setRoutineSavedMsg(null), 2500);
    setEditingRoutine((prev) => (prev ? { ...prev, name: cleanName } : null));
  };

  const handleCloseEditModal = async () => {
    if (
      editingRoutine &&
      editRoutineNameInput.trim() &&
      editRoutineNameInput.trim() !== editingRoutine.name
    ) {
      const cleanName = editRoutineNameInput.trim();
      if (editingRoutine.focusKey.startsWith('custom_')) {
        const routineId = Number(editingRoutine.focusKey.replace('custom_', ''));
        await db.runAsync('UPDATE routines SET name = ? WHERE id = ?', [cleanName, routineId]);
      } else {
        await setCustomFocusLabel(db, editingRoutine.focusKey, cleanName);
      }
      await loadData();
    }
    setEditingRoutine(null);
  };

  const handleRemoveExerciseFromModal = async (exerciseName: string) => {
    if (!editingRoutine) return;
    if (editingRoutine.focusKey.startsWith('custom_')) {
      const routineId = Number(editingRoutine.focusKey.replace('custom_', ''));
      await db.runAsync(
        `DELETE FROM routine_exercises
         WHERE routine_id = ? AND exercise_id IN (
           SELECT id FROM exercises WHERE name = ? COLLATE NOCASE
         )`,
        [routineId, exerciseName],
      );
    } else {
      await removeTemplateExercise(db, editingRoutine.focusKey, exerciseName);
    }
    await loadData();
    const updatedRoutines = await getAllRoutinesData(db);
    setRoutinesList(updatedRoutines);
    const updated = updatedRoutines.find((r) => r.focusKey === editingRoutine.focusKey);
    if (updated) setEditingRoutine(updated);
  };

  const handleAddExerciseInModal = async () => {
    if (!editingRoutine || !newExerciseInput.trim()) return;
    const cleanName = newExerciseInput.trim();
    if (editingRoutine.focusKey.startsWith('custom_')) {
      const routineId = Number(editingRoutine.focusKey.replace('custom_', ''));
      let exMatch = await db.getFirstAsync<{ id: number }>(
        'SELECT id FROM exercises WHERE name = ? COLLATE NOCASE',
        [cleanName],
      );
      let exId = exMatch?.id;
      if (!exId) {
        const res = await db.runAsync(
          `INSERT INTO exercises (name, body_part, target_muscle, equipment, is_custom, created_at)
           VALUES (?, 'Chest', 'General', 'Dumbbell', 1, ?)`,
          [cleanName, new Date().toISOString()],
        );
        exId = res.lastInsertRowId;
      }
      await db.runAsync(
        `INSERT INTO routine_exercises (routine_id, exercise_id, order_index, target_sets, target_reps)
         VALUES (?, ?, (SELECT COALESCE(MAX(order_index), -1) + 1 FROM routine_exercises WHERE routine_id = ?), 3, '8-12')`,
        [routineId, exId, routineId],
      );
    } else {
      await addTemplateExercise(db, editingRoutine.focusKey, cleanName);
    }
    setNewExerciseInput('');
    setShowAddExerciseBox(false);
    await loadData();
    const updatedRoutines = await getAllRoutinesData(db);
    setRoutinesList(updatedRoutines);
    const updated = updatedRoutines.find((r) => r.focusKey === editingRoutine.focusKey);
    if (updated) setEditingRoutine(updated);
  };

  const handleDeleteRoutineFromModal = async () => {
    if (!editingRoutine) return;
    const target = editingRoutine;
    setEditingRoutine(null);

    if (target.focusKey.startsWith('custom_')) {
      const routineId = Number(target.focusKey.replace('custom_', ''));
      await deleteRoutine(db, routineId);
    } else {
      await db.runAsync('DELETE FROM workout_templates WHERE focus_key = ?', [target.focusKey]);
      await db.runAsync("DELETE FROM settings WHERE key = ?", [`routine_title_${target.focusKey}`]);
    }

    await loadData();
    setDeleteRoutineTarget(null);
  };

  const openAdd = (exercise?: string, last?: WorkoutEntry | null) =>
    router.push({
      pathname: '/edit-workout',
      params: {
        date: today,
        focusKey: selectedKey,
        ...(exercise ? { exercise } : {}),
        ...(last?.weight_lbs !== null && last?.weight_lbs !== undefined
          ? { weight: last.weight_lbs }
          : {}),
        ...(last?.sets !== null && last?.sets !== undefined ? { sets: String(last.sets) } : {}),
        ...(last?.reps ? { reps: last.reps } : {}),
      },
    });

  const openEdit = (entry: WorkoutEntry) =>
    router.push({ pathname: '/edit-workout', params: { entryId: String(entry.id) } });

  const confirmDelete = async (entry: WorkoutEntry) => {
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete ${entry.exercise_name}?`)) {
        await deleteWorkoutEntry(db, entry.id);
        loadData();
      }
      return;
    }
    Alert.alert('Delete exercise?', entry.exercise_name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteWorkoutEntry(db, entry.id);
          loadData();
        },
      },
    ]);
  };

  const progressSets = (progressData ?? []).filter((e) => e.weight_lbs_num !== null);
  const progressPoints = progressSets.map((e) => ({ date: e.date, value: e.weight_lbs_num }));
  const oneRmPoints = progressSets.map((e) => {
    const avgReps = parseRepsAverage(e.reps);
    return {
      date: e.date,
      value: avgReps !== null ? epley1rm(e.weight_lbs_num as number, avgReps) : null,
    };
  });
  const oneRmValues = oneRmPoints
    .map((p) => p.value)
    .filter((v): v is number => v !== null);
  const oneRmBest = oneRmValues.length > 0 ? Math.max(...oneRmValues) : null;
  const oneRmLast =
    [...oneRmPoints].reverse().find((p) => p.value !== null)?.value ?? null;

  const progressLast = progressData && progressData.length > 0 ? progressData[progressData.length - 1] : null;

  // Progressive Overload Advanced Analytics
  const lastEntry = progressLast;
  const lastWeightNum = lastEntry?.weight_lbs_num ?? null;
  const lastRepsStr = lastEntry?.reps ?? '12';
  const lastSetsNum = lastEntry?.sets ?? 3;
  const lastDateFormatted = lastEntry
    ? (() => {
        const d = new Date(lastEntry.date + 'T00:00:00');
        return `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}`;
      })()
    : '—';

  const nextTarget = computeNextProgressionTarget(lastEntry);
  const sessionVolume = computeSessionVolume(lastEntry);
  const progressGain = progressData ? computeProgressGain(progressData) : null;

  return (
    <Screen
      title="Workout"
      subtitle={`${fmtInt(totalSessions)} sessions logged · progressive overload cycle`}
      right={
        <Chip
          label="Calendar & Habits ›"
          active
          onPress={() => router.push({ pathname: '/habit-detail' as any, params: { habit: 'workout' } })}
        />
      }
    >
      {/* TODAY'S ACTIVE SESSION (IF ANY LOGGED) */}
      {todayEntries.length > 0 ? (
        <Card highlight>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="checkmark-circle" size={18} color={C.accent} />
              <Txt size="md" weight="800">
                {`Today's Log · ${focusLabel(todayEntries[0].focus_key)}`}
              </Txt>
            </View>
            <View style={st.badge}>
              <Txt size="xs" weight="800" color={C.accent}>
                {`${todayEntries.length} EXERCISES`}
              </Txt>
            </View>
          </View>

          <Divider />

          {todayEntries.map((e) => (
            <Pressable
              key={e.id}
              onPress={() => openEdit(e)}
              onLongPress={() => confirmDelete(e)}
              style={({ pressed }) => [st.workoutRow, pressed && { opacity: 0.7 }]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Txt size="md" weight="700">
                  {e.exercise_name}
                </Txt>
                <Txt size="sm" color={C.dim} weight="600">
                  {`${e.weight_lbs ?? 'BW'} lbs · ${e.sets ?? '?'} sets × ${e.reps ?? '—'} reps`}
                </Txt>
              </View>
              <Ionicons name="chevron-forward" size={14} color={C.dimmer} />
            </Pressable>
          ))}

          <Button title="+ Add Another Exercise" variant="secondary" small onPress={() => openAdd()} />
        </Card>
      ) : null}

      {/* ======================================================== */}
      {/* MY ROUTINES CATALOG (HEVY / STRONG STYLE)                */}
      {/* ======================================================== */}
      <View style={{ gap: 10 }}>
        {/* Routines Section Header (Tap to Minimize/Expand) */}
        <View style={st.routinesHeaderRow}>
          <Pressable
            onPress={() => setIsRoutinesSectionCollapsed(!isRoutinesSectionCollapsed)}
            style={({ pressed }) => [
              { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons
              name={isRoutinesSectionCollapsed ? 'chevron-forward' : 'chevron-down'}
              size={18}
              color={C.text}
            />
            <Txt size="lg" weight="900" color={C.text}>
              My Routines
            </Txt>
            <View style={st.routineCountPill}>
              <Txt size="xs" weight="800" color={C.dim}>
                {routinesList.length}
              </Txt>
            </View>
          </Pressable>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Pressable
              onPress={() => router.push('/exercise-catalog' as any)}
              style={st.moreHeaderBtn}
            >
              <Ionicons name="search" size={17} color={C.accent} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/routine-builder' as any)}
              style={st.moreHeaderBtn}
            >
              <Ionicons name="add" size={20} color={C.accent} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/edit-workout')}
              style={st.moreHeaderBtn}
            >
              <Ionicons name="ellipsis-vertical" size={18} color={C.dim} />
            </Pressable>
          </View>
        </View>

        {/* Routine Cards List (Collapsible) */}
        {!isRoutinesSectionCollapsed ? (
          routinesList.map((routine) => {
            const isExpanded = expandedRoutineKeys.includes(routine.focusKey);
            const previewExercises = isExpanded ? routine.exercises : routine.exercises.slice(0, 3);
            const remainingCount = Math.max(0, routine.exercises.length - 3);

            return (
              <Card key={routine.focusKey} style={st.routineCard}>
                {/* Routine Card Top Header */}
                <View style={st.routineCardHeader}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt size="lg" weight="900" color={C.text}>
                      {routine.name}
                    </Txt>
                    <Txt size="xs" color={C.dim} weight="600">
                      {`${routine.totalSets} sets`}
                    </Txt>
                  </View>

                  <Pressable
                    onPress={() => openEditRoutineModal(routine)}
                    style={st.threeDotsBtn}
                    hitSlop={8}
                  >
                    <Ionicons name="ellipsis-vertical" size={18} color={C.dim} />
                  </Pressable>
                </View>

                {/* Exercise Items Preview */}
                <View style={{ gap: 12, marginTop: 4 }}>
                  {previewExercises.map((ex, idx) => {
                    const cat = getExerciseCategoryIcon(ex.exercise);
                    return (
                      <View key={`${ex.exercise}-${idx}`} style={st.exercisePreviewRow}>
                        <View style={[st.exerciseAvatarCircle, { backgroundColor: cat.bg }]}>
                          <Ionicons name={cat.icon} size={16} color={cat.color} />
                        </View>

                        <View style={{ flex: 1, gap: 2 }}>
                          <Txt size="sm" weight="700" color={C.text} numberOfLines={1}>
                            {ex.exercise}
                          </Txt>
                          <Txt size="xs" color={C.dim} weight="500">
                            {`${ex.sets} sets${ex.last?.weight_lbs ? ` · Last: ${ex.last.weight_lbs} lbs` : ''}`}
                          </Txt>
                        </View>
                      </View>
                    );
                  })}
                </View>

                {/* Routine Card Footer */}
                <View style={st.routineCardFooter}>
                  {remainingCount > 0 ? (
                    <Pressable
                      onPress={() => toggleExpandRoutine(routine.focusKey)}
                      style={{ paddingVertical: 4 }}
                    >
                      <Txt size="xs" color={C.dim} weight="700">
                        {isExpanded ? 'Show less' : `and ${remainingCount} more...`}
                      </Txt>
                    </Pressable>
                  ) : (
                    <View />
                  )}

                  {/* START Button */}
                  <Pressable
                    onPress={() => handleStartRoutine(routine)}
                    style={({ pressed }) => [st.startBtn, pressed && { opacity: 0.85 }]}
                  >
                    <Txt size="xs" weight="900" color="#fff" style={{ letterSpacing: 0.6 }}>
                      START
                    </Txt>
                  </Pressable>
                </View>
              </Card>
            );
          })
        ) : null}
      </View>

      {/* PROGRESSIVE OVERLOAD GRAPH */}
      <Card>
        {/* Card Header: Title */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <Ionicons name="trending-up-outline" size={16} color={C.blue} />
          <Txt size="xs" weight="800" color={C.dimmer} style={{ letterSpacing: 1.2 }}>
            PROGRESSIVE OVERLOAD ANALYTICS
          </Txt>
        </View>

        {/* Routine Selector Dropdown Row */}
        <Pressable
          onPress={() => setShowRoutineDropdownModal(true)}
          style={({ pressed }) => [st.routineSelectorRowBtn, pressed && { opacity: 0.75 }]}
          hitSlop={6}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <Ionicons name="barbell" size={14} color={C.accent} />
            <Txt size="sm" weight="800" color={C.text} numberOfLines={1}>
              {routinesList.find((r) => r.focusKey === selectedKey)?.name ?? 'Select Routine'}
            </Txt>
          </View>
          <Ionicons name="chevron-down" size={14} color={C.dim} style={{ marginLeft: 6 }} />
        </Pressable>

        {focusExercises.length === 0 ? (
          <EmptyHint title="No exercises recorded yet for this routine" />
        ) : (
          <>
            <ChipRow>
              {focusExercises.map((ex) => (
                <Chip
                  key={ex}
                  label={ex}
                  active={ex === progressExercise}
                  onPress={() => setProgressExercise(ex)}
                />
              ))}
            </ChipRow>

            {progressExercise ? (
              <>
                <TrendChart
                  data={progressPoints}
                  secondary={oneRmPoints}
                  secondaryColor={C.blue}
                  color={C.weight}
                  yFormat={(n) => fmtNum(n, 1)}
                  height={190}
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

                {/* 4 PROGRESSIVE OVERLOAD ADVANCED STAT METRICS */}
                <View style={st.analyticsGrid}>
                  {/* CARD 1: LAST PERFORMANCE */}
                  <View style={st.analyticsCard}>
                    <Txt size="xs" weight="800" color={C.dim} style={{ letterSpacing: 0.6 }}>
                      LAST PERFORMANCE
                    </Txt>
                    <View style={st.metricValuePill}>
                      <Txt size="sm" weight="900" color={C.text}>
                        {lastWeightNum !== null ? `${fmtNum(lastWeightNum, 1)} lbs × ${lastRepsStr}` : '—'}
                      </Txt>
                    </View>
                    <Txt size="xs" color={C.dimmer} weight="600">
                      {`${lastDateFormatted} (${lastSetsNum} sets)`}
                    </Txt>
                  </View>

                  {/* CARD 2: NEXT TARGET (Green Accent) */}
                  <View style={[st.analyticsCard, st.analyticsCardHighlight]}>
                    <Txt size="xs" weight="800" color={C.accent} style={{ letterSpacing: 0.6 }}>
                      NEXT TARGET
                    </Txt>
                    <View style={[st.metricValuePill, { backgroundColor: C.accentSoft }]}>
                      <Txt size="sm" weight="900" color={C.accent}>
                        {nextTarget.targetLabel}
                      </Txt>
                    </View>
                    <Txt size="xs" color={C.accent} weight="700">
                      {nextTarget.advice}
                    </Txt>
                  </View>

                  {/* CARD 3: SESSION VOLUME */}
                  <View style={st.analyticsCard}>
                    <Txt size="xs" weight="800" color={C.dim} style={{ letterSpacing: 0.6 }}>
                      SESSION VOLUME
                    </Txt>
                    <View style={st.metricValuePill}>
                      <Txt size="sm" weight="900" color={C.text}>
                        {sessionVolume !== null ? `${fmtInt(sessionVolume)} lbs` : '—'}
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
                        {oneRmLast !== null ? `${fmtNum(oneRmLast, 0)} lbs` : '—'}
                      </Txt>
                    </View>
                    <Txt size="xs" color={C.dimmer} weight="600">
                      {progressGain
                        ? `${progressGain.percentGain >= 0 ? '+' : ''}${progressGain.percentGain}% since ${progressGain.firstDateFormatted}`
                        : oneRmBest !== null
                          ? `All-Time Best: ${fmtNum(oneRmBest, 0)} lbs`
                          : '1RM Epley Standard'}
                    </Txt>
                  </View>
                </View>
              </>
            ) : null}
          </>
        )}
      </Card>

      {/* SEPARATE WORKOUT CATALOG CARD */}
      <Card>
        <Pressable
          onPress={() => router.push('/exercise-catalog' as any)}
          style={({ pressed }) => [
            { flexDirection: 'row', alignItems: 'center', gap: 12 },
            pressed && { opacity: 0.8 },
          ]}
        >
          <View style={st.catalogIconCircle}>
            <Ionicons name="barbell" size={20} color={C.accent} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt size="md" weight="800" color={C.text}>
              Workout Exercise Catalog
            </Txt>
            <Txt size="xs" color={C.dim}>
              Browse 900+ exercises, anatomy filters, & custom lifts
            </Txt>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.dim} />
        </Pressable>
      </Card>

      {/* RECENT SESSIONS */}
      <Card>
        <CardTitle
          icon={<Ionicons name="time-outline" size={16} color={C.dim} />}
          action={
            <Chip
              label="Full Calendar ›"
              active
              small
              onPress={() =>
                router.push({ pathname: '/habit-detail' as any, params: { habit: 'workout' } })
              }
            />
          }
        >
          SESSION HISTORY
        </CardTitle>
        {recent.length === 0 ? (
          <EmptyHint title="No workouts logged yet" />
        ) : (
          recent.map((d, idx) => (
            <View key={d.date}>
              {idx > 0 ? <Divider /> : null}
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/workout-day', params: { date: d.date } })
                }
                style={({ pressed }) => [st.recentRow, pressed && { opacity: 0.7 }]}
              >
                <View style={{ gap: 2 }}>
                  <Txt size="md" weight="700">
                    {focusLabel(d.focusKey)}
                  </Txt>
                  <Txt size="xs" color={C.dimmer} weight="600">
                    {formatDayLabel(d.date)}
                  </Txt>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={st.exerciseCountPill}>
                    <Txt size="xs" weight="800" color={C.dim}>
                      {`${d.count} exercises`}
                    </Txt>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={C.dimmer} />
                </View>
              </Pressable>
            </View>
          ))
        )}

        {totalSessions > 0 ? (
          <Button
            title={`View Complete History (${totalSessions} Sessions) ›`}
            variant="secondary"
            onPress={() => router.push({ pathname: '/workout-history-list' as any })}
          />
        ) : null}
      </Card>

      {/* EDIT ROUTINE MODAL (OPENED FROM 3-DOTS BUTTON) */}
      <Modal
        visible={editingRoutine !== null}
        transparent
        animationType="fade"
        onRequestClose={handleCloseEditModal}
      >
        <Pressable
          style={st.modalOverlay}
          onPress={handleCloseEditModal}
        >
          <Pressable
            style={st.modalCard}
            onPress={(e) => e.stopPropagation?.()}
          >
            {editingRoutine ? (
              <View style={{ gap: 14 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Txt size="lg" weight="900" color={C.text}>
                    Edit Routine
                  </Txt>
                  <Pressable onPress={handleCloseEditModal} style={{ padding: 4 }}>
                    <Ionicons name="close" size={20} color={C.dim} />
                  </Pressable>
                </View>

                {/* Rename Routine Title */}
                <View style={{ gap: 6 }}>
                  <NumberField
                    label="Routine Title"
                    value={editRoutineNameInput}
                    onChangeText={setEditRoutineNameInput}
                    onCommit={handleSaveRoutineTitle}
                    placeholder="e.g. Push, Pull, Legs…"
                  />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Txt size="xs" color={C.accent} weight="700">
                      {routineSavedMsg ?? ''}
                    </Txt>
                    <Button
                      title="Save Routine Name"
                      variant="secondary"
                      small
                      onPress={handleSaveRoutineTitle}
                    />
                  </View>
                </View>

                <Divider />

                {/* Exercises in this Routine */}
                <View style={{ gap: 6 }}>
                  <Txt size="xs" weight="800" color={C.dimmer} style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                    Exercises ({editingRoutine.exercises.length})
                  </Txt>
                  {editingRoutine.exercises.map((ex) => (
                    <View key={ex.exercise} style={st.modalExerciseRow}>
                      <Txt size="sm" weight="700" color={C.text} style={{ flex: 1 }}>
                        {ex.exercise}
                      </Txt>
                      <Pressable
                        onPress={() => handleRemoveExerciseFromModal(ex.exercise)}
                        style={st.modalDeleteBtn}
                      >
                        <Ionicons name="trash-outline" size={16} color={C.danger} />
                      </Pressable>
                    </View>
                  ))}
                </View>

                {/* Add New Exercise to Routine */}
                {showAddExerciseBox ? (
                  <View style={st.addExerciseBox}>
                    <NumberField
                      label="New Exercise Name"
                      value={newExerciseInput}
                      onChangeText={setNewExerciseInput}
                      placeholder="e.g. Dumbbell Shoulder Press, Lateral Raises…"
                    />
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                      <Button
                        title="+ Add Exercise"
                        small
                        onPress={handleAddExerciseInModal}
                        disabled={!newExerciseInput.trim()}
                      />
                      <Button
                        title="Cancel"
                        variant="ghost"
                        small
                        onPress={() => {
                          setNewExerciseInput('');
                          setShowAddExerciseBox(false);
                        }}
                      />
                    </View>
                  </View>
                ) : (
                  <Button
                    title="+ Add Exercise to Routine"
                    variant="secondary"
                    small
                    onPress={() => setShowAddExerciseBox(true)}
                  />
                )}

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Delete Routine"
                      variant="danger"
                      onPress={() => setDeleteRoutineTarget(editingRoutine)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Done"
                      onPress={handleCloseEditModal}
                    />
                  </View>
                </View>
              </View>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Routine Selector Dropdown Modal */}
      <Modal
        visible={showRoutineDropdownModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRoutineDropdownModal(false)}
      >
        <Pressable
          style={st.modalOverlay}
          onPress={() => setShowRoutineDropdownModal(false)}
        >
          <Pressable style={st.modalCard} onPress={(e) => e.stopPropagation?.()}>
            <View style={{ gap: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Txt size="lg" weight="900" color={C.text}>
                  Select Routine
                </Txt>
                <Pressable onPress={() => setShowRoutineDropdownModal(false)} style={{ padding: 4 }}>
                  <Ionicons name="close" size={20} color={C.dim} />
                </Pressable>
              </View>

              <View style={{ gap: 6 }}>
                {routinesList.map((r) => {
                  const active = r.focusKey === selectedKey;
                  return (
                    <Pressable
                      key={r.focusKey}
                      onPress={() => {
                        setSelectedKey(r.focusKey);
                        setShowRoutineDropdownModal(false);
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

      {/* Delete Routine Confirmation Dialog */}
      <ConfirmModal
        visible={Boolean(deleteRoutineTarget)}
        title="Delete Routine"
        message={`Are you sure you want to delete "${deleteRoutineTarget?.name}"? All exercises in this routine will be removed.`}
        confirmText="Delete"
        danger
        onConfirm={handleDeleteRoutineFromModal}
        onCancel={() => setDeleteRoutineTarget(null)}
      />
    </Screen>
  );
}

const st = StyleSheet.create({
  badge: {
    backgroundColor: C.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  routinesHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginTop: 4,
  },
  routineCountPill: {
    backgroundColor: C.surfaceHi,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  moreHeaderBtn: {
    padding: 6,
    borderRadius: 8,
  },
  routineCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.borderLight,
    gap: 12,
  },
  routineCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  threeDotsBtn: {
    padding: 6,
    borderRadius: 8,
  },
  exercisePreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  exerciseAvatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routineCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  startBtn: {
    backgroundColor: '#38BDF8', // Cyan button matching Hevy/Strong design
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 10,
    shadowColor: '#38BDF8',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  workoutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  legendBox: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 4,
    backgroundColor: C.surfaceAlt,
    borderRadius: 10,
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
  recentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  exerciseCountPill: {
    backgroundColor: C.surfaceHi,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
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
  modalExerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  modalDeleteBtn: {
    padding: 6,
  },
  addExerciseBox: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: C.borderLight,
    gap: 6,
  },
  exerciseCatalogBannerBtn: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
    marginVertical: 4,
  },
  catalogIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
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
    marginBottom: 8,
    alignSelf: 'flex-start',
    minWidth: 140,
    maxWidth: 220,
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
