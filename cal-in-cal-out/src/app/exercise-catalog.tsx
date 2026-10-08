import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { useDb } from '@/db/db';
import {
  addExerciseToRoutine,
  createCustomExercise,
  deleteCustomExercise,
  recentUsedExercises,
  searchExercises,
} from '@/db/workouts';
import { addExerciseToDraft } from '@/lib/routineDraft';
import type { BodyPart, ExerciseItem } from '@/lib/types';
import { Button, ConfirmModal, Screen, Txt } from '@/components/ui';

const BODY_PARTS: (BodyPart | 'All')[] = [
  'All',
  'Chest',
  'Back',
  'Shoulders',
  'Arms',
  'Legs',
  'Core',
];

export default function ExerciseCatalogScreen() {
  const db = useDb();
  const params = useLocalSearchParams<{
    mode?: 'picker' | 'browse';
    routineId?: string;
    onSelect?: string;
  }>();

  const isPicker = params.mode === 'picker';
  const routineId = params.routineId ? Number(params.routineId) : null;

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBodyPart, setSelectedBodyPart] = useState<BodyPart | 'All'>('All');
  const [exercises, setExercises] = useState<ExerciseItem[]>([]);
  const [recent, setRecent] = useState<ExerciseItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Custom Exercise Modal
  const [modalVisible, setModalVisible] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customBodyPart, setCustomBodyPart] = useState<BodyPart>('Chest');
  const [customMuscle, setCustomMuscle] = useState('');
  const [customEquipment, setCustomEquipment] = useState('');
  const [customNotes, setCustomNotes] = useState('');
  const [savingCustom, setSavingCustom] = useState(false);

  // Delete confirm modal
  const [deleteTarget, setDeleteTarget] = useState<ExerciseItem | null>(null);

  // Exercise detail modal
  const [detailTarget, setDetailTarget] = useState<ExerciseItem | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const results = await searchExercises(db, searchQuery, selectedBodyPart, 150);
    setExercises(results);
    setLoading(false);
  }, [db, searchQuery, selectedBodyPart]);

  const loadRecent = useCallback(async () => {
    try {
      const rows = await recentUsedExercises(db, 12);
      setRecent(rows);
    } catch {
      setRecent([]);
    }
  }, [db]);

  // Debounced live search
  useEffect(() => {
    const timer = setTimeout(() => {
      loadData();
    }, 120);
    return () => clearTimeout(timer);
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      loadData();
      loadRecent();
    }, [loadData, loadRecent]),
  );

  const handleSaveCustom = async () => {
    if (!customName.trim()) {
      alert('Please provide an exercise name.');
      return;
    }
    setSavingCustom(true);
    try {
      const newId = await createCustomExercise(db, {
        name: customName,
        body_part: customBodyPart,
        target_muscle: customMuscle,
        equipment: customEquipment,
        notes: customNotes,
      });

      setModalVisible(false);
      setCustomName('');
      setCustomMuscle('');
      setCustomEquipment('');
      setCustomNotes('');
      await loadData();
      loadRecent();

      if (isPicker && routineId) {
        // Return picked ID if picker
        router.back();
      }
    } catch (e: any) {
      alert(`Could not save exercise: ${e.message || 'Already exists'}`);
    } finally {
      setSavingCustom(false);
    }
  };

  const pickExercise = async (item: ExerciseItem) => {
    if (routineId) {
      await addExerciseToRoutine(db, routineId, item.id);
    }
    if (params.onSelect === 'builder') {
      addExerciseToDraft(item.name, item.id);
    }
    router.back();
  };

  const handleSelectExercise = async (item: ExerciseItem) => {
    if (isPicker) {
      await pickExercise(item);
      return;
    }
    setDetailTarget(item);
  };

  const handleDeleteCustom = async () => {
    if (!deleteTarget) return;
    await deleteCustomExercise(db, deleteTarget.id);
    setDeleteTarget(null);
    loadData();
    loadRecent();
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

          <Txt size="xl" weight="900" color={C.text}>
            {isPicker ? 'Select Exercise' : 'Exercise Catalog'}
          </Txt>

          <Pressable
            onPress={() => setModalVisible(true)}
            style={({ pressed }) => [st.addHeaderBtn, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="add" size={16} color={C.accent} />
            <Txt size="xs" weight="800" color={C.accent}>
              New
            </Txt>
          </Pressable>
        </View>
      }
    >
      {/* 1. SEARCH BAR */}
      <View style={st.searchContainer}>
        <View style={st.searchBar}>
          <Ionicons name="search" size={18} color={C.dim} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search exercises, muscles, equipment…"
            placeholderTextColor={C.dimmer}
            style={st.searchInput}
            autoCorrect={false}
          />
          {searchQuery ? (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={C.dim} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* 2. BODY PART FILTER PILL CHIPS */}
      <View style={{ marginBottom: 12 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={st.chipsScrollRow}
        >
          {BODY_PARTS.map((bp) => {
            const active = selectedBodyPart === bp;
            return (
              <Pressable
                key={bp}
                onPress={() => setSelectedBodyPart(bp)}
                style={[st.filterChip, active && st.filterChipActive]}
              >
                <Txt
                  size="xs"
                  weight={active ? '800' : '600'}
                  color={active ? C.onAccent : C.dim}
                >
                  {bp}
                </Txt>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* 2.5 RECENTLY USED EXERCISES */}
      {!searchQuery &&
      recent.filter((r) => selectedBodyPart === 'All' || r.body_part === selectedBodyPart)
        .length > 0 ? (
        <View style={{ marginBottom: 12, gap: 8 }}>
          <View style={st.recentHeader}>
            <Ionicons name="time-outline" size={13} color={C.dim} />
            <Txt size="xs" weight="800" color={C.dim}>
              RECENTLY USED
            </Txt>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={st.recentChipsRow}
          >
            {recent
              .filter((r) => selectedBodyPart === 'All' || r.body_part === selectedBodyPart)
              .map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => handleSelectExercise(item)}
                  style={({ pressed }) => [st.recentChip, pressed && { opacity: 0.6 }]}
                >
                  <Txt size="xs" weight="700" color={C.text}>
                    {item.name}
                  </Txt>
                </Pressable>
              ))}
          </ScrollView>
        </View>
      ) : null}

      {/* 3. EXERCISE LIST */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40, gap: 8 }}
      >
        {loading ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}>
            <ActivityIndicator size="small" color={C.accent} />
          </View>
        ) : exercises.length > 0 ? (
          exercises.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => handleSelectExercise(item)}
              style={({ pressed }) => [st.exerciseCard, pressed && { opacity: 0.7 }]}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Txt size="sm" weight="800" color={C.text}>
                    {item.name}
                  </Txt>
                  {item.is_custom === 1 ? (
                    <View style={st.customBadge}>
                      <Txt size="xs" weight="800" color={C.accent}>
                        CUSTOM
                      </Txt>
                    </View>
                  ) : null}
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={st.bodyPartPill}>
                    <Txt size="xs" weight="700" color={C.dim}>
                      {item.body_part}
                    </Txt>
                  </View>
                  <Txt size="xs" color={C.dimmer}>•</Txt>
                  <Txt size="xs" color={C.dim}>
                    {item.target_muscle}
                  </Txt>
                  {item.equipment ? (
                    <>
                      <Txt size="xs" color={C.dimmer}>•</Txt>
                      <Txt size="xs" color={C.dim}>
                        {item.equipment}
                      </Txt>
                    </>
                  ) : null}
                </View>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {item.is_custom === 1 ? (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation?.();
                      setDeleteTarget(item);
                    }}
                    hitSlop={8}
                    style={st.trashBtn}
                  >
                    <Ionicons name="trash-outline" size={16} color={C.dimmer} />
                  </Pressable>
                ) : null}

                {isPicker ? (
                  <>
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation?.();
                        setDetailTarget(item);
                      }}
                      hitSlop={8}
                      style={st.trashBtn}
                    >
                      <Ionicons name="information-circle-outline" size={18} color={C.dim} />
                    </Pressable>
                    <Ionicons name="add-circle" size={24} color={C.accent} />
                  </>
                ) : (
                  <Ionicons name="chevron-forward" size={16} color={C.dimmer} />
                )}
              </View>
            </Pressable>
          ))
        ) : (
          <View style={st.emptyState}>
            <Ionicons name="barbell-outline" size={36} color={C.dimmer} />
            <Txt size="sm" color={C.dimmer} align="center">
              No exercises found for &quot;{searchQuery}&quot;
            </Txt>
            <Pressable
              onPress={() => {
                setCustomName(searchQuery);
                setModalVisible(true);
              }}
              style={st.createPromptBtn}
            >
              <Txt size="xs" weight="800" color={C.accent}>
                + Create &quot;{searchQuery}&quot; as Custom Exercise
              </Txt>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* 4. ADD CUSTOM EXERCISE MODAL */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable
          style={st.modalBackdrop}
          onPress={() => setModalVisible(false)}
        >
          <Pressable style={st.modalSheet} onPress={(e) => e.stopPropagation?.()}>
            <View style={st.modalHeader}>
              <Txt size="lg" weight="900" color={C.text}>
                Create Custom Exercise
              </Txt>
              <Pressable
                onPress={() => setModalVisible(false)}
                hitSlop={8}
              >
                <Ionicons name="close" size={20} color={C.dim} />
              </Pressable>
            </View>

            <View style={{ gap: 14 }}>
              {/* Exercise Name */}
              <View style={{ gap: 4 }}>
                <Txt size="xs" weight="700" color={C.dim}>
                  EXERCISE NAME *
                </Txt>
                <TextInput
                  value={customName}
                  onChangeText={setCustomName}
                  placeholder="e.g. Incline Smith Machine Press"
                  placeholderTextColor={C.dimmer}
                  style={st.inputField}
                />
              </View>

              {/* Body Part Selector */}
              <View style={{ gap: 6 }}>
                <Txt size="xs" weight="700" color={C.dim}>
                  BODY PART *
                </Txt>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8 }}
                >
                  {(['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Core'] as BodyPart[]).map(
                    (bp) => {
                      const active = customBodyPart === bp;
                      return (
                        <Pressable
                          key={bp}
                          onPress={() => setCustomBodyPart(bp)}
                          style={[st.bodyPartSelectChip, active && st.bodyPartSelectChipActive]}
                        >
                          <Txt
                            size="xs"
                            weight={active ? '800' : '600'}
                            color={active ? C.onAccent : C.text}
                          >
                            {bp}
                          </Txt>
                        </Pressable>
                      );
                    },
                  )}
                </ScrollView>
              </View>

              {/* Primary Muscle */}
              <View style={{ gap: 4 }}>
                <Txt size="xs" weight="700" color={C.dim}>
                  PRIMARY MUSCLE (OPTIONAL)
                </Txt>
                <TextInput
                  value={customMuscle}
                  onChangeText={setCustomMuscle}
                  placeholder="e.g. Upper Chest, Lats, Quads"
                  placeholderTextColor={C.dimmer}
                  style={st.inputField}
                />
              </View>

              {/* Equipment */}
              <View style={{ gap: 4 }}>
                <Txt size="xs" weight="700" color={C.dim}>
                  EQUIPMENT (OPTIONAL)
                </Txt>
                <TextInput
                  value={customEquipment}
                  onChangeText={setCustomEquipment}
                  placeholder="e.g. Barbell, Dumbbell, Cable, Machine"
                  placeholderTextColor={C.dimmer}
                  style={st.inputField}
                />
              </View>

              {/* Notes */}
              <View style={{ gap: 4 }}>
                <Txt size="xs" weight="700" color={C.dim}>
                  NOTES / FORM CUES
                </Txt>
                <TextInput
                  value={customNotes}
                  onChangeText={setCustomNotes}
                  placeholder="e.g. 30 degree incline, slow negative"
                  placeholderTextColor={C.dimmer}
                  style={st.inputField}
                />
              </View>

              <View style={{ marginTop: 6 }}>
                <Button
                  title={savingCustom ? 'Saving…' : 'Save Custom Exercise'}
                  onPress={handleSaveCustom}
                  disabled={savingCustom}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        visible={Boolean(deleteTarget)}
        title="Delete Custom Exercise"
        message={`Are you sure you want to remove "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        danger
        onConfirm={handleDeleteCustom}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Exercise Detail Modal */}
      <Modal
        visible={Boolean(detailTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailTarget(null)}
      >
        <Pressable style={st.modalBackdrop} onPress={() => setDetailTarget(null)}>
          <Pressable style={st.detailSheet} onPress={(e) => e.stopPropagation?.()}>
            <View style={st.modalHeader}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  flex: 1,
                  paddingRight: 8,
                }}
              >
                <Txt
                  size="lg"
                  weight="900"
                  color={C.text}
                  numberOfLines={2}
                  style={{ flexShrink: 1 }}
                >
                  {detailTarget?.name}
                </Txt>
                {detailTarget?.is_custom === 1 ? (
                  <View style={st.customBadge}>
                    <Txt size="xs" weight="800" color={C.accent}>
                      CUSTOM
                    </Txt>
                  </View>
                ) : null}
              </View>
              <Pressable onPress={() => setDetailTarget(null)} hitSlop={8}>
                <Ionicons name="close" size={20} color={C.dim} />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ gap: 16 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={st.bodyPartPill}>
                  <Txt size="xs" weight="700" color={C.dim}>
                    {detailTarget?.body_part}
                  </Txt>
                </View>
                {detailTarget?.equipment ? (
                  <View style={st.bodyPartPill}>
                    <Txt size="xs" weight="700" color={C.dim}>
                      {detailTarget.equipment}
                    </Txt>
                  </View>
                ) : null}
              </View>

              <View style={{ gap: 4 }}>
                <Txt size="xs" weight="700" color={C.dim}>
                  PRIMARY MUSCLE
                </Txt>
                <Txt size="md" weight="800" color={C.text}>
                  {detailTarget?.target_muscle || '—'}
                </Txt>
              </View>

              <View style={{ gap: 6 }}>
                <Txt size="xs" weight="700" color={C.dim}>
                  {detailTarget?.is_custom === 1 ? 'NOTES / FORM CUES' : 'INSTRUCTIONS'}
                </Txt>
                <Txt size="sm" color={C.text}>
                  {detailTarget?.notes || 'No instructions available for this exercise.'}
                </Txt>
              </View>
            </ScrollView>

            {isPicker ? (
              <Button
                title="Add Exercise"
                onPress={() => {
                  if (!detailTarget) return;
                  const item = detailTarget;
                  setDetailTarget(null);
                  pickExercise(item);
                }}
              />
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
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
    paddingBottom: 12,
  },
  backBtn: {
    padding: 4,
  },
  addHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: C.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.accent + '35',
  },
  searchContainer: {
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceHi,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 10 : 7,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    color: C.text,
    fontSize: 14,
    padding: 0,
  },
  chipsScrollRow: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterChip: {
    backgroundColor: C.surface,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
  },
  filterChipActive: {
    backgroundColor: C.accent,
    borderColor: C.accent,
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 16,
  },
  recentChipsRow: {
    paddingHorizontal: 16,
    gap: 8,
  },
  recentChip: {
    backgroundColor: C.surfaceHi,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.accent + '40',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  exerciseCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  customBadge: {
    backgroundColor: C.accentSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.accent + '40',
  },
  bodyPartPill: {
    backgroundColor: C.surfaceHi,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  trashBtn: {
    padding: 6,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  createPromptBtn: {
    backgroundColor: C.surfaceHi,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.accent + '40',
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
    maxWidth: 420,
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: C.borderLight,
    gap: 16,
  },
  detailSheet: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
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
  inputField: {
    backgroundColor: C.surfaceHi,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.text,
    fontSize: 14,
  },
  bodyPartSelectChip: {
    backgroundColor: C.surfaceHi,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  bodyPartSelectChipActive: {
    backgroundColor: C.accent,
    borderColor: C.accent,
  },
});
