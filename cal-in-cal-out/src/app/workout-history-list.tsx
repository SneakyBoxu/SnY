import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { C } from '@/constants/theme';
import { formatDayLabel } from '@/lib/date';
import { fmtInt } from '@/lib/num';
import { useDb } from '@/db/db';
import {
  allWorkoutSessions,
  countWorkoutDays,
  deleteWorkoutSession,
  focusLabel,
  type WorkoutSessionSummary,
} from '@/db/workouts';
import { FOCUS_CYCLE } from '@/db/seed-workouts';
import {
  Card,
  Chip,
  ChipRow,
  ConfirmModal,
  Divider,
  EmptyHint,
  Screen,
  Txt,
} from '@/components/ui';

const FOCUS_FILTER_LABELS: Record<string, string> = {
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  shoulders_chest: 'Shoulders & Chest',
  arm_core: 'Arm & Core',
};

export default function WorkoutHistoryListScreen() {
  const db = useDb();
  const [selectedFocus, setSelectedFocus] = useState<string | null>(null);
  const [sessions, setSessions] = useState<WorkoutSessionSummary[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<WorkoutSessionSummary | null>(null);

  const load = useCallback(async () => {
    const [list, count] = await Promise.all([
      allWorkoutSessions(db, selectedFocus),
      countWorkoutDays(db),
    ]);
    setSessions(list);
    setTotalCount(count);
  }, [db, selectedFocus]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleDeleteSession = async () => {
    if (!deleteTarget) return;
    await deleteWorkoutSession(db, deleteTarget.date, selectedFocus);
    setDeleteTarget(null);
    load();
  };

  if (sessions === null) {
    return <Screen title="Workout History" loading onBack={() => router.back()} />;
  }

  return (
    <Screen
      title="Workout History"
      subtitle={`${fmtInt(totalCount)} total sessions · complete historical logs`}
      onBack={() => router.back()}
      right={
        <Chip
          label="Calendar ▾"
          active
          onPress={() =>
            router.push({ pathname: '/habit-detail' as any, params: { habit: 'workout' } })
          }
        />
      }
    >
      {/* FILTER CHIPS */}
      <ChipRow>
        <Chip
          label={`All (${totalCount})`}
          active={selectedFocus === null}
          onPress={() => setSelectedFocus(null)}
        />
        {FOCUS_CYCLE.map((k) => (
          <Chip
            key={k}
            label={FOCUS_FILTER_LABELS[k] ?? k}
            active={selectedFocus === k}
            onPress={() => setSelectedFocus(selectedFocus === k ? null : k)}
          />
        ))}
      </ChipRow>

      {/* SESSIONS LIST */}
      {sessions.length === 0 ? (
        <Card>
          <EmptyHint
            icon={<Ionicons name="barbell-outline" size={32} color={C.dimmer} />}
            title="No sessions found"
            sub="Try selecting a different filter above."
          />
        </Card>
      ) : (
        <Card style={{ padding: 12 }}>
          {sessions.map((s, idx) => (
            <View key={s.date}>
              {idx > 0 ? <Divider /> : null}
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/workout-day', params: { date: s.date } })
                }
                style={({ pressed }) => [st.sessionRow, pressed && { opacity: 0.7 }]}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Txt size="md" weight="800" color={C.text}>
                      {focusLabel(s.focusKey)}
                    </Txt>
                    <View style={st.countBadge}>
                      <Txt size="xs" weight="800" color={C.accent}>
                        {`${s.count} exercises`}
                      </Txt>
                    </View>
                  </View>

                  <Txt size="xs" color={C.dimmer} weight="600">
                    {formatDayLabel(s.date)}
                  </Txt>

                  {s.preview ? (
                    <Txt size="xs" color={C.dim} numberOfLines={1} style={{ marginTop: 2 }}>
                      {s.preview}
                    </Txt>
                  ) : null}
                </View>

                <Pressable
                  onPress={(e) => {
                    e.stopPropagation?.();
                    setDeleteTarget(s);
                  }}
                  hitSlop={10}
                  style={({ pressed }) => [st.trashBtn, pressed && { opacity: 0.5 }]}
                >
                  <Ionicons name="trash-outline" size={17} color={C.dimmer} />
                </Pressable>

                <Ionicons name="chevron-forward" size={16} color={C.dimmer} style={{ marginLeft: 8 }} />
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      <Txt size="xs" color={C.dimmer} align="center" style={{ marginTop: 4 }}>
        Showing {sessions.length} sessions · Tap any session to view sets & reps
      </Txt>

      <ConfirmModal
        visible={Boolean(deleteTarget)}
        title="Delete Workout Session"
        message={`Remove the ${focusLabel(deleteTarget?.focusKey ?? '')} session from ${
          deleteTarget ? formatDayLabel(deleteTarget.date) : ''
        }? All ${deleteTarget?.count ?? 0} logged exercise${(deleteTarget?.count ?? 0) === 1 ? '' : 's'} will be permanently deleted.`}
        confirmText="Delete"
        danger
        onConfirm={handleDeleteSession}
        onCancel={() => setDeleteTarget(null)}
      />
    </Screen>
  );
}

const st = StyleSheet.create({
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  countBadge: {
    backgroundColor: C.accentSoft,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  trashBtn: {
    padding: 6,
  },
});
