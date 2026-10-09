import { useEffect, useState } from 'react';
import { Alert, Keyboard, Platform, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { Spacing } from '@/constants/theme';
import { todayISO } from '@/lib/date';
import { parseNumber } from '@/lib/num';
import { useDb } from '@/db/db';
import { FOCUS_CYCLE, FOCUS_LABELS } from '@/db/seed-workouts';
import {
  deleteWorkoutEntry,
  getWorkoutEntry,
  insertWorkoutEntry,
  updateWorkoutEntry,
  type WorkoutLogInput,
} from '@/db/workouts';
import {
  Button,
  Card,
  CardTitle,
  NumberField,
  Screen,
  Segmented,
  TextField,
  Txt,
} from '@/components/ui';

const SHORT_LABELS: Record<string, string> = {
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  shoulders_chest: 'Shoulders & Chest',
  arm_core: 'Arm & Core',
};

function parseLbs(raw: string): { weightLbs: string | null; num: number | null } {
  const t = raw.trim();
  if (t === '') return { weightLbs: null, num: null };
  const n = parseNumber(t);
  return { weightLbs: t, num: n };
}

export default function EditWorkoutScreen() {
  const db = useDb();
  const params = useLocalSearchParams<{
    entryId?: string;
    date?: string;
    focusKey?: string;
    exercise?: string;
    weight?: string;
    sets?: string;
    reps?: string;
  }>();

  const entryIdParam = params.entryId;
  const editing = entryIdParam !== undefined;
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const [exercise, setExercise] = useState(params.exercise ?? '');
  const [weight, setWeight] = useState(params.weight ?? '');
  const [sets, setSets] = useState(params.sets ?? '');
  const [reps, setReps] = useState(params.reps ?? '');
  const [focusKey, setFocusKey] = useState<string>(params.focusKey ?? 'push');
  const [date, setDate] = useState<string>(params.date ?? todayISO());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) return;
    const id = Number(entryIdParam);
    let live = true;
    getWorkoutEntry(db, id).then((entry) => {
      if (!entry || !live) return;
      setLoadedId(entry.id);
      setExercise(entry.exercise_name);
      setWeight(entry.weight_lbs ?? '');
      setSets(entry.sets !== null ? String(entry.sets) : '');
      setReps(entry.reps ?? '');
      setFocusKey(entry.focus_key);
      setDate(entry.date);
    });
    return () => {
      live = false;
    };
  }, [db, editing, entryIdParam]);

  const onSave = async () => {
    if (exercise.trim() === '') {
      Alert.alert('Missing exercise', 'Enter the exercise name.');
      return;
    }
    setSaving(true);
    const { weightLbs, num } = parseLbs(weight);
    const input: WorkoutLogInput = {
      date,
      focusKey,
      exercise: exercise.trim(),
      weightLbs,
      weightLbsNum: num,
      sets: parseNumber(sets) !== null ? Math.round(parseNumber(sets) as number) : null,
      reps: reps.trim() === '' ? null : reps.trim(),
    };
    if (editing && loadedId !== null) {
      await updateWorkoutEntry(db, loadedId, input);
    } else {
      await insertWorkoutEntry(db, input);
    }
    setSaving(false);
    Keyboard.dismiss();
    router.back();
  };

  const onDelete = async () => {
    if (!loadedId) return;
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete ${exercise}?`)) {
        setSaving(true);
        await deleteWorkoutEntry(db, loadedId);
        setSaving(false);
        router.back();
      }
      return;
    }
    Alert.alert('Delete Exercise?', exercise, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setSaving(true);
          await deleteWorkoutEntry(db, loadedId);
          setSaving(false);
          router.back();
        },
      },
    ]);
  };

  return (
    <Screen
      title={editing ? 'Edit exercise' : 'Log exercise'}
      subtitle={date}
      onBack={() => router.back()}
      right={
        <Button
          title={saving ? 'Saving…' : 'Save'}
          small
          onPress={onSave}
          disabled={saving}
        />
      }
    >
      <Card>
        <CardTitle>Exercise</CardTitle>
        <TextField
          label=""
          value={exercise}
          onChangeText={setExercise}
          placeholder="e.g. Barbell Bench Press"
          autoCapitalize="words"
        />
        <View style={{ flexDirection: 'row', gap: 10, marginTop: Spacing.s }}>
          <TextField
            label="Weight (lbs)"
            value={weight}
            onChangeText={setWeight}
            placeholder="75 / BW"
            keyboardType="default"
            style={{ flex: 1.4 }}
          />
          <NumberField
            label="Sets"
            value={sets}
            onChangeText={setSets}
            placeholder="3"
            style={{ flex: 0.9 }}
          />
          <TextField
            label="Reps"
            value={reps}
            onChangeText={setReps}
            placeholder="12,12,10"
            keyboardType="numbers-and-punctuation"
            style={{ flex: 1.4 }}
          />
        </View>
        <Txt size="xs" style={{ color: '#8B99A8', marginTop: 4 }}>
          {'Free text allowed: "Bodyweight", drop sets like "75 -> BW", or "BW + 15 lbs".'}
        </Txt>
      </Card>

      <Card>
        <CardTitle>Session</CardTitle>
        <Segmented
          options={FOCUS_CYCLE.map((k) => SHORT_LABELS[k] ?? k)}
          value={SHORT_LABELS[focusKey] ?? focusKey}
          onChange={(label) => {
            const key = FOCUS_CYCLE.find((k) => (SHORT_LABELS[k] ?? k) === label);
            if (key) setFocusKey(key);
          }}
        />
        <Txt size="xs" style={{ color: '#8B99A8', marginTop: Spacing.xs }}>
          {FOCUS_LABELS[focusKey] ?? focusKey}
        </Txt>
      </Card>

      {editing ? (
        <Button
          title="Delete Exercise"
          variant="danger"
          onPress={onDelete}
          disabled={saving}
        />
      ) : null}
    </Screen>
  );
}
