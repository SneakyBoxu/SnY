import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { C } from '@/constants/theme';
import { Txt } from '@/components/ui';

export interface HabitData {
  title: string;
  subtitle?: string;
  activeDays: boolean[]; // 30 booleans: index 0 = 29 days ago, index 29 = today
  color: string;
  weekStat: string;
  onPress?: () => void;
}

export function HabitCard({
  title,
  subtitle = 'Last 30 Days',
  activeDays,
  color,
  weekStat,
  onPress,
}: HabitData) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        st.card,
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={{ gap: 2 }}>
        <Txt size="md" weight="800" color={C.text}>
          {title}
        </Txt>
        <Txt size="xs" color={C.dimmer} weight="600">
          {subtitle}
        </Txt>
      </View>

      {/* 3x10 Dot Matrix Heatmap Grid */}
      <View style={st.matrixContainer}>
        {[0, 1, 2].map((rowIdx) => (
          <View key={rowIdx} style={st.matrixRow}>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((colIdx) => {
              const dayIdx = rowIdx * 10 + colIdx;
              const isActive = activeDays[dayIdx] ?? false;
              return (
                <View
                  key={colIdx}
                  style={[
                    st.dot,
                    {
                      backgroundColor: isActive ? color : C.surfaceHi,
                    },
                  ]}
                />
              );
            })}
          </View>
        ))}
      </View>

      {/* Footer Week Stat with Chevron */}
      <View style={st.footerRow}>
        <Txt size="sm" weight="800" color={C.text}>
          {weekStat}
        </Txt>
        <Ionicons name="chevron-forward" size={14} color={C.dimmer} />
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    gap: 12,
    minWidth: 195,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  matrixContainer: {
    gap: 5,
    paddingVertical: 4,
  },
  matrixRow: {
    flexDirection: 'row',
    gap: 5,
  },
  dot: {
    width: 13,
    height: 11,
    borderRadius: 3,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 2,
  },
});
