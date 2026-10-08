import React, { useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { C } from '@/constants/theme';
import { useDb } from '@/db/db';
import {
  addExerciseToRoutine,
  createRoutine,
} from '@/db/workouts';
import {
  clearRoutineDraft,
  getRoutineDraft,
  setDraftExercises,
  setRoutineDraftName,
  subscribeRoutineDraft,
  type BuilderExercise,
} from '@/lib/routineDraft';
import { Screen, Txt } from '@/components/ui';

export default function RoutineBuilderScreen() {
  const db = useDb();

  const [routineName, setRoutineName] = useState(() => getRoutineDraft().name);
  const [exercises, setExercises] = useState<BuilderExercise[]>(() => getRoutineDraft().exercises);
  const [saving, setSaving] = useState(false);

  // Sync with central routine draft store
  useEffect(() => {
    const unsub = subscribeRoutineDraft(() => {
      const d = getRoutineDraft();
      setRoutineName(d.name);
      setExercises(d.exercises);
    });
    return unsub;
  }, []);

  const handleUpdateName = (val: string) => {
    setRoutineName(val);
    setRoutineDraftName(val);
  };

  // Add set to exercise
  const addSetToExercise = (exIdx: number) => {
    const copy = [...exercises];
    const target = copy[exIdx];
    const nextNum = target.sets.length + 1;
    const lastSet = target.sets[target.sets.length - 1];

    copy[exIdx] = {
      ...target,
      sets: [
        ...target.sets,
        {
          setNumber: nextNum,
          prevStr: '-',
          weightLbs: lastSet ? lastSet.weightLbs : '',
          repsStr: lastSet ? lastSet.repsStr : '10',
        },
      ],
    };
    setExercises(copy);
    setDraftExercises(copy);
  };

  // Remove set from exercise
  const removeSetFromExercise = (exIdx: number, setIdx: number) => {
    const copy = [...exercises];
    const target = copy[exIdx];
    const filtered = target.sets.filter((_, i) => i !== setIdx);
    const renumbered = filtered.map((s, i) => ({ ...s, setNumber: i + 1 }));
    copy[exIdx] = { ...target, sets: renumbered };
    setExercises(copy);
    setDraftExercises(copy);
  };

  // Update set values
  const updateSetValue = (
    exIdx: number,
    setIdx: number,
    field: 'weightLbs' | 'repsStr',
    val: string,
  ) => {
    const copy = [...exercises];
    const ex = copy[exIdx];
    const sets = [...ex.sets];
    sets[setIdx] = { ...sets[setIdx], [field]: val };
    copy[exIdx] = { ...ex, sets };
    setExercises(copy);
    setDraftExercises(copy);
  };

  // Update exercise notes
  const updateExerciseNotes = (exIdx: number, val: string) => {
    const copy = [...exercises];
    copy[exIdx] = { ...copy[exIdx], notes: val };
    setExercises(copy);
    setDraftExercises(copy);
  };

  // Remove exercise
  const removeExercise = (exIdx: number) => {
    const filtered = exercises.filter((_, i) => i !== exIdx);
    setExercises(filtered);
    setDraftExercises(filtered);
  };

  // Save the complete Routine to database
  const handleSaveRoutine = async () => {
    const trimmed = routineName.trim();
    if (!trimmed) {
      alert('Please enter a routine name.');
      return;
    }
    setSaving(true);
    try {
      const newRoutineId = await createRoutine(db, trimmed);

      for (const ex of exercises) {
        let exerciseId = ex.exerciseId;
        if (!exerciseId) {
          const match = await db.getFirstAsync<{ id: number }>(
            'SELECT id FROM exercises WHERE name = ? COLLATE NOCASE',
            [ex.name],
          );
          if (match) {
            exerciseId = match.id;
          } else {
            const res = await db.runAsync(
              `INSERT INTO exercises (name, body_part, target_muscle, equipment, is_custom, created_at)
               VALUES (?, 'Chest', 'General', 'Dumbbell', 1, ?)`,
              [ex.name, new Date().toISOString()],
            );
            exerciseId = res.lastInsertRowId;
          }
        }

        const repCount = ex.sets[0]?.repsStr || '8-12';
        await addExerciseToRoutine(db, newRoutineId, exerciseId, ex.sets.length, repCount);
      }

      clearRoutineDraft();
      router.back();
    } catch (e: any) {
      alert(`Could not save routine: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

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

          <Txt size="md" weight="800" color={C.dim} style={{ letterSpacing: 0.2 }}>
            Create &gt; New Routine
          </Txt>

          <Pressable
            onPress={handleSaveRoutine}
            disabled={saving}
            style={({ pressed }) => [st.saveBtn, pressed && { opacity: 0.6 }]}
            hitSlop={10}
          >
            <Ionicons name="checkmark" size={24} color="#38BDF8" />
          </Pressable>
        </View>
      }
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* 1. ROUTINE NAME INPUT BOX */}
        <View style={{ gap: 6 }}>
          <Txt size="lg" weight="900" color={C.text}>
            Routine Name
          </Txt>
          <View style={st.nameInputBox}>
            <TextInput
              value={routineName}
              onChangeText={handleUpdateName}
              placeholder="Routine Name"
              placeholderTextColor={C.dimmer}
              style={st.nameTextInput}
            />
          </View>
        </View>

        {/* 2. WORKOUT CONTENT SECTION */}
        <View style={{ gap: 10 }}>
          <Txt size="lg" weight="900" color={C.text}>
            Workout Content
          </Txt>

          {exercises.map((ex, exIdx) => (
            <View key={ex.id} style={st.exerciseCard}>
              {/* Exercise Card Header */}
              <View style={st.exerciseCardHeader}>
                <View style={st.exIconBadge}>
                  <Ionicons name="barbell" size={16} color={C.accent} />
                </View>
                <Txt size="md" weight="800" color={C.text} style={{ flex: 1 }}>
                  {ex.name}
                </Txt>
                <Pressable
                  onPress={() => removeExercise(exIdx)}
                  hitSlop={8}
                  style={{ padding: 4 }}
                >
                  <Ionicons name="ellipsis-vertical" size={18} color={C.dim} />
                </Pressable>
              </View>

              {/* Add Exercise Notes Field */}
              <View style={st.notesBox}>
                <TextInput
                  value={ex.notes}
                  onChangeText={(val) => updateExerciseNotes(exIdx, val)}
                  placeholder="Add Exercise Notes…"
                  placeholderTextColor={C.dimmer}
                  style={st.notesTextInput}
                />
              </View>

              {/* Table Column Headers */}
              <View style={st.tableHeaderRow}>
                <Txt size="xs" color={C.dimmer} weight="800" style={st.colSet}>
                  SET
                </Txt>
                <Txt size="xs" color={C.dimmer} weight="800" style={st.colPrev}>
                  PREV
                </Txt>
                <Txt size="xs" color={C.dimmer} weight="800" style={st.colLbs}>
                  LBS
                </Txt>
                <Txt size="xs" color={C.dimmer} weight="800" style={st.colReps}>
                  REPS
                </Txt>
                <View style={st.colAction} />
              </View>

              {/* Sets Rows */}
              <View style={{ gap: 8 }}>
                {ex.sets.map((s, sIdx) => (
                  <View key={s.setNumber} style={st.setRow}>
                    <View style={st.colSet}>
                      <View style={st.setNumCircle}>
                        <Txt size="sm" weight="800" color={C.text}>
                          {s.setNumber}
                        </Txt>
                      </View>
                    </View>

                    <View style={st.colPrev}>
                      <Txt size="sm" color={C.dim} weight="600" align="center">
                        {s.prevStr}
                      </Txt>
                    </View>

                    <View style={st.colLbs}>
                      <View style={st.inputBox}>
                        <TextInput
                          value={s.weightLbs}
                          onChangeText={(v) => updateSetValue(exIdx, sIdx, 'weightLbs', v)}
                          placeholder="-"
                          placeholderTextColor={C.dimmer}
                          keyboardType="numeric"
                          style={st.cellTextInput}
                        />
                      </View>
                    </View>

                    <View style={st.colReps}>
                      <View style={st.inputBox}>
                        <TextInput
                          value={s.repsStr}
                          onChangeText={(v) => updateSetValue(exIdx, sIdx, 'repsStr', v)}
                          placeholder="-"
                          placeholderTextColor={C.dimmer}
                          keyboardType="numeric"
                          style={st.cellTextInput}
                        />
                      </View>
                    </View>

                    {/* Red Round Minus/Delete Button */}
                    <View style={st.colAction}>
                      <Pressable
                        onPress={() => removeSetFromExercise(exIdx, sIdx)}
                        style={st.deleteSetCircleBtn}
                      >
                        <Ionicons name="remove" size={16} color="#FFFFFF" />
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>

              {/* ADD SET Action */}
              <Pressable
                onPress={() => addSetToExercise(exIdx)}
                style={({ pressed }) => [st.addSetBtn, pressed && { opacity: 0.7 }]}
              >
                <Txt size="xs" weight="900" color={C.dim} style={{ letterSpacing: 0.8 }}>
                  ADD SET
                </Txt>
              </Pressable>
            </View>
          ))}

          {/* Large "+ Exercise" Button (Light blue pill like screenshot) */}
          <View style={{ alignItems: 'center', marginTop: 14 }}>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/exercise-catalog' as any,
                  params: { mode: 'picker', onSelect: 'builder' },
                })
              }
              style={({ pressed }) => [st.addExerciseBigBtn, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name="add" size={18} color="#080B10" />
              <Txt size="md" weight="900" color="#080B10">
                Exercise
              </Txt>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
  },
  backBtn: {
    padding: 4,
  },
  saveBtn: {
    padding: 4,
  },
  nameInputBox: {
    backgroundColor: '#121824',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
  },
  nameTextInput: {
    color: C.text,
    fontSize: 16,
    fontWeight: '600',
    padding: 0,
  },
  exerciseCard: {
    backgroundColor: '#111726',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    gap: 12,
  },
  exerciseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  exIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notesBox: {
    backgroundColor: '#151E30',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  notesTextInput: {
    color: C.dim,
    fontSize: 13,
    fontWeight: '500',
    padding: 0,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  colSet: {
    width: 44,
    alignItems: 'center',
  },
  colPrev: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  colLbs: {
    width: 76,
    marginRight: 8,
  },
  colReps: {
    width: 76,
    marginRight: 8,
  },
  colAction: {
    width: 36,
    alignItems: 'center',
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  setNumCircle: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#182236',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputBox: {
    backgroundColor: '#182236',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#24324D',
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellTextInput: {
    color: C.text,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    padding: 0,
    width: '100%',
  },
  deleteSetCircleBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addSetBtn: {
    backgroundColor: '#161F33',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  addExerciseBigBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#60A5FA',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 22,
    shadowColor: '#60A5FA',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 3,
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
    maxWidth: 400,
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: C.borderLight,
    gap: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTextInput: {
    backgroundColor: C.surfaceHi,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.text,
    fontSize: 14,
  },
});
