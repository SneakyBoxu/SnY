import React, { useCallback, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { C } from '@/constants/theme';
import { formatDayLabel, todayISO } from '@/lib/date';
import { parseNumber } from '@/lib/num';
import type { WorkoutEntry } from '@/lib/types';
import { useDb } from '@/db/db';
import {
  deleteWorkoutEntry,
  focusLabel,
  lastEntryForExercise,
  listWorkoutEntries,
  updateWorkoutEntry,
} from '@/db/workouts';
import { Button, ConfirmModal, NumberField, Screen, TextField, Txt } from '@/components/ui';

export type SetType = 'NORMAL' | 'WARMUP' | 'FAILURE' | 'DROP';

interface EditSetRow {
  setNumber: number;
  setType?: SetType;
  prevStr: string;
  weightLbs: string;
  repsStr: string;
}

interface EditableExerciseGroup {
  entryId: number;
  exerciseName: string;
  focusKey: string;
  sets: EditSetRow[];
  isDirty?: boolean;
}

export default function WorkoutDayScreen() {
  const db = useDb();
  const { date } = useLocalSearchParams<{ date: string }>();
  const day = date ?? todayISO();

  const [rawEntries, setRawEntries] = useState<WorkoutEntry[] | null>(null);
  const [exerciseGroups, setExerciseGroups] = useState<EditableExerciseGroup[]>([]);
  const [loading, setLoading] = useState(true);

  // Column PREV mode: toggle between 'lbs' and 'reps'
  const [prevDisplayMode, setPrevDisplayMode] = useState<'lbs' | 'reps'>('lbs');

  // Set Type Picker Modal state
  const [activeSetPicker, setActiveSetPicker] = useState<{
    groupIndex: number;
    setIndex: number;
  } | null>(null);

  // 3-Dots Menu State
  const [activeMenuIdx, setActiveMenuIdx] = useState<number | null>(null);
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [replaceNameInput, setReplaceNameInput] = useState('');

  // Confirmation Modal: "Are you sure you want to edit previous workout?"
  const [pendingSaveIdx, setPendingSaveIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete exercise confirm modal
  const [deleteTarget, setDeleteTarget] = useState<EditableExerciseGroup | null>(null);

  const togglePrevDisplayMode = () => {
    setPrevDisplayMode((mode) => (mode === 'lbs' ? 'reps' : 'lbs'));
  };

  const formatPrevDisplay = (prevStr: string, setIdx: number) => {
    if (!prevStr || prevStr === '-') return '-';

    if (prevStr.includes('×')) {
      const parts = prevStr.split('×');
      const wPart = parts[0]?.replace(/lbs/i, '').trim(); // e.g. "100"
      const rPart = parts[1]?.trim(); // e.g. "12,12,12"

      if (prevDisplayMode === 'lbs') {
        return wPart || prevStr;
      }

      if (prevDisplayMode === 'reps') {
        const repList = rPart?.split(',').map((x) => x.trim()).filter(Boolean);
        const specificRep = repList ? (repList[setIdx] ?? repList[repList.length - 1] ?? rPart) : rPart;
        return specificRep || prevStr;
      }
    }

    return prevStr;
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    const list = await listWorkoutEntries(db, day);
    setRawEntries(list);

    // Group or transform each entry into editable sets
    const groups: EditableExerciseGroup[] = await Promise.all(
      list.map(async (entry) => {
        const setCount = entry.sets || 3;
        const repsParts = (entry.reps || '10').split(',').map((r) => r.trim());
        const wLbs = entry.weight_lbs ?? '';

        // Fetch previous performance from before this date
        const last = await lastEntryForExercise(db, entry.exercise_name, entry.date);
        const prevWeight = last?.weight_lbs ?? null;
        const prevReps = last?.reps ?? null;
        const prevStr =
          prevWeight !== null && prevReps !== null
            ? `${prevWeight} lbs × ${prevReps}`
            : prevWeight !== null
              ? `${prevWeight} lbs`
              : '-';

        const sets: EditSetRow[] = [];
        for (let s = 1; s <= setCount; s++) {
          sets.push({
            setNumber: s,
            setType: 'NORMAL',
            prevStr,
            weightLbs: wLbs === 'Bodyweight' ? '' : wLbs,
            repsStr: repsParts[s - 1] ?? repsParts[0] ?? '10',
          });
        }

        return {
          entryId: entry.id,
          exerciseName: entry.exercise_name,
          focusKey: entry.focus_key,
          sets,
          isDirty: false,
        };
      }),
    );

    setExerciseGroups(groups);
    setLoading(false);
  }, [db, day]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const updateSetValue = (
    groupIndex: number,
    setIndex: number,
    field: 'weightLbs' | 'repsStr',
    val: string,
  ) => {
    setExerciseGroups((prev) => {
      const copy = [...prev];
      const target = { ...copy[groupIndex] };
      const sets = [...target.sets];
      sets[setIndex] = { ...sets[setIndex], [field]: val };
      target.sets = sets;
      target.isDirty = true;
      copy[groupIndex] = target;
      return copy;
    });
  };

  // Set type change handler (Warmup, Normal, Failure, Drop)
  const handleChangeSetType = (setType: SetType) => {
    if (!activeSetPicker) return;
    const { groupIndex, setIndex } = activeSetPicker;
    setExerciseGroups((prev) => {
      const copy = [...prev];
      const target = { ...copy[groupIndex] };
      const sets = [...target.sets];
      sets[setIndex] = { ...sets[setIndex], setType };
      target.sets = sets;
      target.isDirty = true;
      copy[groupIndex] = target;
      return copy;
    });
    setActiveSetPicker(null);
  };

  // Remove set from Set Type Modal
  const handleRemoveSetFromPicker = () => {
    if (!activeSetPicker) return;
    const { groupIndex, setIndex } = activeSetPicker;
    setExerciseGroups((prev) => {
      const copy = [...prev];
      const target = { ...copy[groupIndex] };
      if (target.sets.length <= 1) return prev;
      const filtered = target.sets
        .filter((_, i) => i !== setIndex)
        .map((s, i) => ({ ...s, setNumber: i + 1 }));
      target.sets = filtered;
      target.isDirty = true;
      copy[groupIndex] = target;
      return copy;
    });
    setActiveSetPicker(null);
  };

  // 3-Dots Action 1: Add set to exercise
  const handleAddSetToExercise = (groupIndex: number) => {
    setActiveMenuIdx(null);
    setExerciseGroups((prev) => {
      const copy = [...prev];
      const target = { ...copy[groupIndex] };
      const nextNum = target.sets.length + 1;
      const lastSet = target.sets[target.sets.length - 1];

      const newSet: EditSetRow = {
        setNumber: nextNum,
        setType: 'NORMAL',
        prevStr: lastSet?.prevStr ?? '-',
        weightLbs: lastSet?.weightLbs || '',
        repsStr: lastSet?.repsStr || '10',
      };

      target.sets = [...target.sets, newSet];
      target.isDirty = true;
      copy[groupIndex] = target;
      return copy;
    });
  };

  // 3-Dots Action 2: Remove exercise completely
  const handleRemoveExercise = (group: EditableExerciseGroup) => {
    setActiveMenuIdx(null);
    setDeleteTarget(group);
  };

  const confirmDeleteExercise = async () => {
    if (!deleteTarget) return;
    await deleteWorkoutEntry(db, deleteTarget.entryId);
    setDeleteTarget(null);
    loadData();
  };

  // 3-Dots Action 3: Replace exercise name
  const handleConfirmReplace = () => {
    if (activeMenuIdx === null || !replaceNameInput.trim()) return;
    const cleanName = replaceNameInput.trim();
    setExerciseGroups((prev) => {
      const copy = [...prev];
      copy[activeMenuIdx] = {
        ...copy[activeMenuIdx],
        exerciseName: cleanName,
        isDirty: true,
      };
      return copy;
    });
    setReplaceNameInput('');
    setShowReplaceModal(false);
    setActiveMenuIdx(null);
  };

  // Request save with confirmation dialog
  const requestSaveExercise = (groupIndex: number) => {
    setPendingSaveIdx(groupIndex);
  };

  // Confirmed save to SQLite
  const handleExecuteSave = async () => {
    if (pendingSaveIdx === null) return;
    const group = exerciseGroups[pendingSaveIdx];
    if (!group) return;

    setSaving(true);
    try {
      const repsString = group.sets.map((s) => s.repsStr || '10').join(',');
      const lastWeight = group.sets[group.sets.length - 1]?.weightLbs || '';
      const wNum = parseNumber(lastWeight);

      await updateWorkoutEntry(db, group.entryId, {
        date: day,
        focusKey: group.focusKey,
        exercise: group.exerciseName,
        weightLbs: lastWeight ? lastWeight : 'Bodyweight',
        weightLbsNum: wNum,
        sets: group.sets.length,
        reps: repsString,
      });

      setExerciseGroups((prev) => {
        const copy = [...prev];
        copy[pendingSaveIdx] = { ...copy[pendingSaveIdx], isDirty: false };
        return copy;
      });
      setPendingSaveIdx(null);
    } catch (e: any) {
      alert(`Could not save changes: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const focusTitle = focusLabel(rawEntries?.[0]?.focus_key ?? 'push');

  return (
    <Screen
      customHeader={
        <View style={st.headerBar}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [st.backBtn, pressed && { opacity: 0.6 }]}
            hitSlop={10}
          >
            <Ionicons name="arrow-back" size={22} color={C.text} />
          </Pressable>

          <View style={{ flex: 1, marginLeft: 12 }}>
            <Txt size="xl" weight="900" color={C.text} style={{ letterSpacing: -0.5 }}>
              {focusTitle}
            </Txt>
            <Txt size="xs" color={C.dim} weight="600">
              {formatDayLabel(day)}
            </Txt>
          </View>
        </View>
      }
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60, gap: 14 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* EXERCISES LOGGED LIST IN ACTIVE WORKOUT STYLE */}
        {exerciseGroups.length > 0 ? (
          exerciseGroups.map((group, gIdx) => (
            <View key={group.entryId} style={st.exerciseCard}>
              {/* Exercise Header */}
              <View style={st.exerciseCardHeader}>
                <View style={st.avatarCircle}>
                  <Ionicons name="barbell" size={18} color={C.accent} />
                </View>

                <Txt size="md" weight="800" color={C.text} style={{ flex: 1 }}>
                  {group.exerciseName}
                </Txt>

                <Pressable
                  onPress={() => setActiveMenuIdx(gIdx)}
                  hitSlop={8}
                  style={{ padding: 4 }}
                >
                  <Ionicons name="ellipsis-vertical" size={18} color={C.dim} />
                </Pressable>
              </View>

              {/* Table Column Headers */}
              <View style={st.tableHeaderRow}>
                <Txt size="xs" color={C.dimmer} weight="800" style={st.colSet}>
                  SET
                </Txt>

                {/* PREV Header - Toggles between PREV LBS & PREV REPS */}
                <Pressable
                  onPress={togglePrevDisplayMode}
                  hitSlop={8}
                  style={st.colPrevHeaderBtn}
                >
                  <Txt
                    size="xs"
                    color={C.accent}
                    weight="800"
                    style={{ fontSize: 10, letterSpacing: -0.2 }}
                  >
                    {prevDisplayMode === 'lbs' ? 'PREV LBS' : 'PREV REPS'}
                  </Txt>
                  <Ionicons
                    name="swap-horizontal"
                    size={9}
                    color={C.accent}
                    style={{ marginLeft: 2 }}
                  />
                </Pressable>

                <Txt size="xs" color={C.dimmer} weight="800" style={st.colLbs}>
                  LBS
                </Txt>
                <Txt size="xs" color={C.dimmer} weight="800" style={st.colReps}>
                  REPS
                </Txt>
                <View style={st.colCheck}>
                  <Ionicons name="checkmark-done" size={15} color={C.accent} />
                </View>
              </View>

              {/* Set Rows */}
              <View style={{ gap: 8 }}>
                {group.sets.map((s, sIdx) => {
                  const badge =
                    s.setType === 'WARMUP'
                      ? { text: 'W', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.15)' }
                      : s.setType === 'FAILURE'
                        ? { text: 'F', color: '#EF4444', bg: 'rgba(239, 68, 68, 0.15)' }
                        : s.setType === 'DROP'
                          ? { text: 'D', color: '#38BDF8', bg: 'rgba(56, 189, 248, 0.15)' }
                          : { text: String(s.setNumber), color: C.text, bg: C.surfaceAlt };

                  return (
                    <View key={s.setNumber} style={st.setRow}>
                      {/* Set Number / Set Type button -> Tapping brings up Select Set Type modal */}
                      <View style={st.colSet}>
                        <Pressable
                          onPress={() => setActiveSetPicker({ groupIndex: gIdx, setIndex: sIdx })}
                          style={[st.setNumCircle, { backgroundColor: badge.bg }]}
                        >
                          <Txt size="sm" weight="900" color={badge.color}>
                            {badge.text}
                          </Txt>
                        </Pressable>
                      </View>

                      {/* PREV Container with cycling value */}
                      <View style={st.colPrev}>
                        <Pressable
                          onPress={togglePrevDisplayMode}
                          hitSlop={4}
                          style={st.prevContainerBtn}
                        >
                          <Txt
                            size="xs"
                            color={C.dim}
                            weight="700"
                            numberOfLines={1}
                            align="center"
                          >
                            {formatPrevDisplay(s.prevStr, sIdx)}
                          </Txt>
                        </Pressable>
                      </View>

                      {/* LBS Input Box */}
                      <View style={st.colLbs}>
                        <View style={st.inputBox}>
                          <TextInput
                            value={s.weightLbs}
                            onChangeText={(v) => updateSetValue(gIdx, sIdx, 'weightLbs', v)}
                            placeholder="-"
                            placeholderTextColor={C.dimmer}
                            keyboardType="numeric"
                            style={st.cellTextInput}
                          />
                        </View>
                      </View>

                      {/* REPS Input Box */}
                      <View style={st.colReps}>
                        <View style={st.inputBox}>
                          <TextInput
                            value={s.repsStr}
                            onChangeText={(v) => updateSetValue(gIdx, sIdx, 'repsStr', v)}
                            placeholder="-"
                            placeholderTextColor={C.dimmer}
                            keyboardType="numeric"
                            style={st.cellTextInput}
                          />
                        </View>
                      </View>

                      <View style={st.colCheck}>
                        <View style={st.completedCheckCircle}>
                          <Ionicons name="checkmark" size={16} color="#080B10" />
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* Save changes button appears if modified */}
              {group.isDirty ? (
                <View style={{ marginTop: 6 }}>
                  <Button
                    title="Save Changes to Workout"
                    onPress={() => requestSaveExercise(gIdx)}
                  />
                </View>
              ) : null}
            </View>
          ))
        ) : (
          <View style={st.emptyState}>
            <Ionicons name="barbell-outline" size={40} color={C.dimmer} />
            <Txt size="md" color={C.dimmer} align="center">
              No exercises logged for this workout day.
            </Txt>
          </View>
        )}
      </ScrollView>

      {/* SELECT SET TYPE MODAL (Warmup, Normal, Failure, Drop, Remove Set) */}
      <Modal
        visible={activeSetPicker !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveSetPicker(null)}
      >
        <Pressable style={st.modalBackdrop} onPress={() => setActiveSetPicker(null)}>
          <Pressable style={st.modalSheet} onPress={(e) => e.stopPropagation?.()}>
            <View style={st.modalHeader}>
              <Txt size="lg" weight="900" color={C.text}>
                Select Set Type
              </Txt>
              <Pressable onPress={() => setActiveSetPicker(null)} hitSlop={8}>
                <Ionicons name="close" size={20} color={C.dim} />
              </Pressable>
            </View>

            <View style={{ gap: 8 }}>
              {/* W · Warm Up Set */}
              <Pressable
                onPress={() => handleChangeSetType('WARMUP')}
                style={({ pressed }) => [st.setTypeOptionRow, pressed && { opacity: 0.7 }]}
              >
                <View style={[st.setTypeIconBox, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
                  <Txt size="md" weight="900" color="#F59E0B">
                    W
                  </Txt>
                </View>
                <Txt size="md" weight="800" color={C.text}>
                  Warm Up Set
                </Txt>
              </Pressable>

              {/* 1 · Normal Set */}
              <Pressable
                onPress={() => handleChangeSetType('NORMAL')}
                style={({ pressed }) => [st.setTypeOptionRow, pressed && { opacity: 0.7 }]}
              >
                <View style={st.setTypeIconBox}>
                  <Txt size="md" weight="900" color={C.text}>
                    1
                  </Txt>
                </View>
                <Txt size="md" weight="800" color={C.text}>
                  Normal Set
                </Txt>
              </Pressable>

              {/* F · Failure Set */}
              <Pressable
                onPress={() => handleChangeSetType('FAILURE')}
                style={({ pressed }) => [st.setTypeOptionRow, pressed && { opacity: 0.7 }]}
              >
                <View style={[st.setTypeIconBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                  <Txt size="md" weight="900" color="#EF4444">
                    F
                  </Txt>
                </View>
                <Txt size="md" weight="800" color={C.text}>
                  Failure Set
                </Txt>
              </Pressable>

              {/* D · Drop Set */}
              <Pressable
                onPress={() => handleChangeSetType('DROP')}
                style={({ pressed }) => [st.setTypeOptionRow, pressed && { opacity: 0.7 }]}
              >
                <View style={[st.setTypeIconBox, { backgroundColor: 'rgba(56, 189, 248, 0.15)' }]}>
                  <Txt size="md" weight="900" color="#38BDF8">
                    D
                  </Txt>
                </View>
                <Txt size="md" weight="800" color={C.text}>
                  Drop Set
                </Txt>
              </Pressable>

              {/* Remove Set Button */}
              <Pressable
                onPress={handleRemoveSetFromPicker}
                style={[st.setTypeOptionRow, { backgroundColor: 'rgba(239, 68, 68, 0.12)', borderColor: '#EF4444' + '40' }]}
              >
                <View style={[st.setTypeIconBox, { backgroundColor: 'transparent' }]}>
                  <Ionicons name="trash" size={18} color="#EF4444" />
                </View>
                <Txt size="md" weight="800" color="#EF4444">
                  Remove Set
                </Txt>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 3-DOTS OPTIONS MODAL */}
      <Modal
        visible={activeMenuIdx !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveMenuIdx(null)}
      >
        <Pressable style={st.modalBackdrop} onPress={() => setActiveMenuIdx(null)}>
          <Pressable style={st.modalSheet} onPress={(e) => e.stopPropagation?.()}>
            <View style={st.modalHeader}>
              <Txt size="lg" weight="900" color={C.text}>
                {activeMenuIdx !== null ? exerciseGroups[activeMenuIdx]?.exerciseName : 'Exercise'}
              </Txt>
              <Pressable onPress={() => setActiveMenuIdx(null)} hitSlop={8}>
                <Ionicons name="close" size={20} color={C.dim} />
              </Pressable>
            </View>

            <View style={{ gap: 6 }}>
              {/* Option 1: Edit / Save Workout */}
              <Pressable
                onPress={() => {
                  if (activeMenuIdx !== null) {
                    requestSaveExercise(activeMenuIdx);
                  }
                  setActiveMenuIdx(null);
                }}
                style={st.menuOptionBtn}
              >
                <Ionicons name="create-outline" size={18} color={C.text} />
                <Txt size="sm" weight="700" color={C.text}>
                  Save / Edit Exercise
                </Txt>
              </Pressable>

              {/* Option 2: Add Set */}
              <Pressable
                onPress={() => {
                  if (activeMenuIdx !== null) {
                    handleAddSetToExercise(activeMenuIdx);
                  }
                }}
                style={st.menuOptionBtn}
              >
                <Ionicons name="add-circle-outline" size={18} color={C.accent} />
                <Txt size="sm" weight="700" color={C.text}>
                  Add Set
                </Txt>
              </Pressable>

              {/* Option 3: Replace Exercise */}
              <Pressable
                onPress={() => {
                  if (activeMenuIdx !== null) {
                    setReplaceNameInput(exerciseGroups[activeMenuIdx]?.exerciseName || '');
                    setShowReplaceModal(true);
                  }
                }}
                style={st.menuOptionBtn}
              >
                <Ionicons name="swap-horizontal-outline" size={18} color="#38BDF8" />
                <Txt size="sm" weight="700" color={C.text}>
                  Replace Exercise
                </Txt>
              </Pressable>

              {/* Option 4: Remove Exercise */}
              <Pressable
                onPress={() => {
                  if (activeMenuIdx !== null) {
                    handleRemoveExercise(exerciseGroups[activeMenuIdx]);
                  }
                }}
                style={[st.menuOptionBtn, { borderBottomWidth: 0 }]}
              >
                <Ionicons name="trash-outline" size={18} color={C.danger} />
                <Txt size="sm" weight="700" color={C.danger}>
                  Remove Exercise from Day
                </Txt>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* REPLACE EXERCISE MODAL */}
      <Modal
        visible={showReplaceModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowReplaceModal(false)}
      >
        <Pressable style={st.modalBackdrop} onPress={() => setShowReplaceModal(false)}>
          <Pressable style={st.modalSheet} onPress={(e) => e.stopPropagation?.()}>
            <View style={st.modalHeader}>
              <Txt size="lg" weight="900" color={C.text}>
                Replace Exercise
              </Txt>
              <Pressable onPress={() => setShowReplaceModal(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color={C.dim} />
              </Pressable>
            </View>

            <View style={{ gap: 8 }}>
              <TextField
                label="New Exercise Name"
                value={replaceNameInput}
                onChangeText={setReplaceNameInput}
                placeholder="e.g. Incline Bench Press…"
                autoCapitalize="words"
              />
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                <Button
                  title="Replace"
                  onPress={handleConfirmReplace}
                  disabled={!replaceNameInput.trim()}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* EDIT PREVIOUS WORKOUT CONFIRMATION MODAL */}
      <ConfirmModal
        visible={pendingSaveIdx !== null}
        title="Edit Previous Workout?"
        message="Are you sure you want to update this previous workout entry? Your progressive overload analytics and history will be updated."
        confirmText="Confirm Edit"
        cancelText="Cancel"
        onConfirm={handleExecuteSave}
        onCancel={() => setPendingSaveIdx(null)}
      />

      {/* DELETE EXERCISE CONFIRMATION MODAL */}
      <ConfirmModal
        visible={Boolean(deleteTarget)}
        title="Remove Exercise?"
        message={`Are you sure you want to remove "${deleteTarget?.exerciseName}" from this day's workout?`}
        confirmText="Remove"
        danger
        onConfirm={confirmDeleteExercise}
        onCancel={() => setDeleteTarget(null)}
      />
    </Screen>
  );
}

const st = StyleSheet.create({
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  backBtn: {
    padding: 4,
  },
  exerciseCard: {
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: C.borderLight,
    gap: 12,
  },
  exerciseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  colSet: {
    width: 36,
    alignItems: 'center',
  },
  colPrevHeaderBtn: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  colPrev: {
    flex: 1.2,
    marginRight: 8,
    justifyContent: 'center',
  },
  prevContainerBtn: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 7,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colLbs: {
    flex: 1,
    marginRight: 8,
    alignItems: 'center',
  },
  colReps: {
    flex: 1,
    marginRight: 8,
    alignItems: 'center',
  },
  colCheck: {
    width: 36,
    alignItems: 'center',
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0C1814',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  setNumCircle: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: C.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputBox: {
    backgroundColor: C.surfaceHi,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 5,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  cellTextInput: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
    padding: 0,
    width: '100%',
  },
  completedCheckCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
    gap: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalSheet: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: C.borderLight,
    gap: 14,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  menuOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  setTypeOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: C.surfaceHi,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  setTypeIconBox: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
