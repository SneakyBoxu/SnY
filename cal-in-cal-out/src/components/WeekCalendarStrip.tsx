import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  GestureResponderEvent,
  LayoutChangeEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { C } from '@/constants/theme';
import { addDays, fromISODate, getMondayOfWeek, todayISO } from '@/lib/date';
import { Txt } from '@/components/ui';

interface DayItem {
  dateISO: string;
  dayLabel: string;
  dayNumber: number;
  isThisWeek: boolean;
  isToday: boolean;
  isSelected: boolean;
  hasLogged: boolean;
}

interface WeekItem {
  weekIndex: number; // 0 = this week, negative = past weeks, positive = future
  mondayISO: string;
  isThisWeek: boolean;
  days: DayItem[];
}

interface WeekCalendarStripProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  loggedDates: Set<string>;
  streak?: number;
  phase?: string;
  rightExtra?: React.ReactNode;
}

const TOTAL_PAST_WEEKS = 12; // 12 past weeks
const TOTAL_FUTURE_WEEKS = 1; // 1 future week
const THIS_WEEK_PAGE_INDEX = TOTAL_PAST_WEEKS; // page index of current week
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function WeekCalendarStrip({
  selectedDate,
  onSelectDate,
  loggedDates,
  streak = 0,
  phase,
  rightExtra,
}: WeekCalendarStripProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [containerWidth, setContainerWidth] = useState<number>(() => {
    const windowW = Dimensions.get('window').width;
    return Math.min(windowW, 720);
  });
  const [showDatePickerModal, setShowDatePickerModal] = useState(false);

  const today = todayISO();
  const currentWeekMonday = getMondayOfWeek(today);

  // Generate weeks: -12 to +1
  const weeks: WeekItem[] = useMemo(() => {
    const list: WeekItem[] = [];
    for (let w = -TOTAL_PAST_WEEKS; w <= TOTAL_FUTURE_WEEKS; w++) {
      const mondayISO = addDays(currentWeekMonday, w * 7);
      const isThisWeek = w === 0;
      const days: DayItem[] = [];

      for (let d = 0; d < 7; d++) {
        const dateISO = addDays(mondayISO, d);
        const dayNumber = fromISODate(dateISO).getDate();
        // If this week: letters (M, T, W, T, F, S, S)
        // If other weeks: numbers (day of the month, e.g. 28, 29, 30, 1, 2)
        const dayLabel = isThisWeek ? DAY_LETTERS[d] : String(dayNumber);

        days.push({
          dateISO,
          dayLabel,
          dayNumber,
          isThisWeek,
          isToday: dateISO === today,
          isSelected: dateISO === selectedDate,
          hasLogged: loggedDates.has(dateISO),
        });
      }

      list.push({
        weekIndex: w,
        mondayISO,
        isThisWeek,
        days,
      });
    }
    return list;
  }, [currentWeekMonday, today, selectedDate, loggedDates]);

  // Find which week page contains selectedDate
  const selectedWeekIndex = useMemo(() => {
    const selectedMonday = getMondayOfWeek(selectedDate);
    const idx = weeks.findIndex((w) => w.mondayISO === selectedMonday);
    return idx !== -1 ? idx : THIS_WEEK_PAGE_INDEX;
  }, [selectedDate, weeks]);

  // Keep a ref to the current week index being viewed
  const currentViewWeekIdxRef = useRef<number>(selectedWeekIndex);
  useEffect(() => {
    currentViewWeekIdxRef.current = selectedWeekIndex;
  }, [selectedWeekIndex]);

  // Initial scroll to selected week or this week
  useEffect(() => {
    const timer = setTimeout(() => {
      if (scrollRef.current && containerWidth > 0) {
        scrollRef.current.scrollTo({
          x: selectedWeekIndex * containerWidth,
          animated: false,
        });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [containerWidth, selectedWeekIndex]);

  const onContainerLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - containerWidth) > 2) {
      setContainerWidth(w);
      if (scrollRef.current) {
        scrollRef.current.scrollTo({
          x: currentViewWeekIdxRef.current * w,
          animated: false,
        });
      }
    }
  };

  // Drag scrubber across the 7 days of the currently visible week
  const isDraggingDayRef = useRef(false);
  const currentWeekRef = useRef<WeekItem>(weeks[selectedWeekIndex] || weeks[THIS_WEEK_PAGE_INDEX]);
  currentWeekRef.current = weeks[currentViewWeekIdxRef.current] || weeks[THIS_WEEK_PAGE_INDEX];

  const handleDaySelectFromX = (locationX: number) => {
    const week = currentWeekRef.current;
    if (!week || !week.days || week.days.length === 0) return;
    const dayWidth = containerWidth / 7;
    const rawIdx = Math.floor(locationX / dayWidth);
    const dayIdx = Math.max(0, Math.min(6, rawIdx));
    const targetDay = week.days[dayIdx];
    if (targetDay && targetDay.dateISO !== selectedDate) {
      onSelectDate(targetDay.dateISO);
    }
  };

  const handlePointerDown = (e: GestureResponderEvent) => {
    isDraggingDayRef.current = true;
    handleDaySelectFromX(e.nativeEvent.locationX);
  };

  const handlePointerMove = (e: GestureResponderEvent) => {
    if (!isDraggingDayRef.current) return;
    handleDaySelectFromX(e.nativeEvent.locationX);
  };

  const handlePointerUp = () => {
    isDraggingDayRef.current = false;
  };

  // Title formatting for the top header
  const headerDateTitle = useMemo(() => {
    if (selectedDate === today) return 'Today';
    if (selectedDate === addDays(today, -1)) return 'Yesterday';
    if (selectedDate === addDays(today, 1)) return 'Tomorrow';
    const d = fromISODate(selectedDate);
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }, [selectedDate, today]);

  return (
    <View style={st.wrapper} onLayout={onContainerLayout}>
      {/* 1. TOP HEADER ROW: "Today ▾" and Right Badges (Streak / Phase) */}
      <View style={st.topBar}>
        {/* Left: Date title with dropdown chevron */}
        <Pressable
          onPress={() => setShowDatePickerModal(true)}
          style={({ pressed }) => [st.dateTitleBtn, pressed && { opacity: 0.7 }]}
          hitSlop={8}
        >
          <Txt size="xl" weight="900" color={C.text} style={{ letterSpacing: -0.5 }}>
            {headerDateTitle}
          </Txt>
          <Ionicons name="caret-down" size={13} color={C.text} style={{ marginTop: 2 }} />
        </Pressable>

        {/* Right side: Streak pill + Jump Today (if not today) + Phase badge */}
        <View style={st.rightControls}>
          {selectedDate !== today ? (
            <Pressable
              onPress={() => onSelectDate(today)}
              style={({ pressed }) => [st.todayJumpBtn, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="calendar-outline" size={12} color={C.accent} />
              <Txt size="xs" weight="800" color={C.accent}>
                Today
              </Txt>
            </Pressable>
          ) : null}

          {/* Streak badge (like "3 ⚡" in screenshot) */}
          <View style={st.streakBadge}>
            <Txt size="sm" weight="800" color={C.text}>
              {streak}
            </Txt>
            <Ionicons name="flash" size={14} color={C.accent} style={{ marginLeft: 2 }} />
          </View>

          {/* Phase badge or extra */}
          {phase ? (
            <View style={st.phaseBadge}>
              <View style={st.pulseDot} />
              <Txt size="xs" weight="800" color={C.accent}>
                {phase.toUpperCase()}
              </Txt>
            </View>
          ) : null}

          {rightExtra}
        </View>
      </View>

      {/* 2. HOLD & DRAG WEEK CALENDAR STRIP */}
      <View
        style={st.stripContainer}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={handlePointerDown}
        onResponderMove={handlePointerMove}
        onResponderRelease={handlePointerUp}
        onResponderTerminate={handlePointerUp}
        {...(Platform.OS === 'web'
          ? ({
              onPointerDown: handlePointerDown,
              onPointerMove: handlePointerMove,
              onPointerUp: handlePointerUp,
              onPointerCancel: handlePointerUp,
              style: [
                st.stripContainer,
                {
                  cursor: 'pointer',
                  userSelect: 'none',
                  touchAction: 'pan-x',
                  WebkitUserSelect: 'none',
                } as any,
              ],
            } as any)
          : {})}
      >
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEnabled={true}
          onMomentumScrollEnd={(e) => {
            const offsetX = e.nativeEvent.contentOffset.x;
            const page = Math.round(offsetX / containerWidth);
            if (page >= 0 && page < weeks.length) {
              currentViewWeekIdxRef.current = page;
            }
          }}
          style={{ width: containerWidth }}
          contentContainerStyle={{ alignItems: 'center' }}
        >
          {weeks.map((week) => (
            <View
              key={week.mondayISO}
              style={[st.weekPage, { width: containerWidth }]}
            >
              {week.days.map((day) => {
                const isSelected = day.dateISO === selectedDate;

                return (
                  <Pressable
                    key={day.dateISO}
                    onPress={() => onSelectDate(day.dateISO)}
                    style={({ pressed }) => [
                      st.dayColumn,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    {/* Top Dot Indicator for active/selected day */}
                    <View
                      style={[
                        st.selectedDot,
                        isSelected && st.selectedDotActive,
                      ]}
                    />

                    {/* Day Label: Letters for this week (M, T, W...), Numbers for other weeks */}
                    <Txt
                      size="xs"
                      weight={isSelected ? '900' : '700'}
                      color={isSelected ? '#FFFFFF' : day.isToday ? C.accent : C.dim}
                      style={st.dayLabelText}
                    >
                      {day.dayLabel}
                    </Txt>

                    {/* Status Circle: Checked if logged, empty circle outline if not */}
                    <View
                      style={[
                        st.statusCircle,
                        day.hasLogged ? st.statusCircleLogged : st.statusCircleEmpty,
                        isSelected && st.statusCircleSelected,
                      ]}
                    >
                      {day.hasLogged ? (
                        <Ionicons
                          name="checkmark"
                          size={12}
                          color="#FFFFFF"
                          style={{ fontWeight: 'bold' }}
                        />
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
      </View>

      {/* 3. QUICK DATE PICKER MODAL */}
      <Modal
        visible={showDatePickerModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDatePickerModal(false)}
      >
        <Pressable
          style={st.modalBackdrop}
          onPress={() => setShowDatePickerModal(false)}
        >
          <Pressable style={st.modalSheet} onPress={(e) => e.stopPropagation?.()}>
            <View style={st.modalHeader}>
              <Txt size="lg" weight="800">
                Select Date
              </Txt>
              <Pressable
                onPress={() => setShowDatePickerModal(false)}
                hitSlop={8}
                style={({ pressed }) => pressed && { opacity: 0.6 }}
              >
                <Ionicons name="close" size={20} color={C.dim} />
              </Pressable>
            </View>

            <View style={st.modalQuickActions}>
              <Pressable
                style={[st.quickDateBtn, selectedDate === today && st.quickDateBtnActive]}
                onPress={() => {
                  onSelectDate(today);
                  setShowDatePickerModal(false);
                }}
              >
                <Ionicons
                  name="today-outline"
                  size={16}
                  color={selectedDate === today ? C.onAccent : C.text}
                />
                <Txt
                  size="sm"
                  weight="700"
                  color={selectedDate === today ? C.onAccent : C.text}
                >
                  Today
                </Txt>
              </Pressable>

              <Pressable
                style={[
                  st.quickDateBtn,
                  selectedDate === addDays(today, -1) && st.quickDateBtnActive,
                ]}
                onPress={() => {
                  onSelectDate(addDays(today, -1));
                  setShowDatePickerModal(false);
                }}
              >
                <Ionicons
                  name="play-back-outline"
                  size={16}
                  color={selectedDate === addDays(today, -1) ? C.onAccent : C.text}
                />
                <Txt
                  size="sm"
                  weight="700"
                  color={selectedDate === addDays(today, -1) ? C.onAccent : C.text}
                >
                  Yesterday
                </Txt>
              </Pressable>

              <Pressable
                style={[
                  st.quickDateBtn,
                  selectedDate === addDays(today, -7) && st.quickDateBtnActive,
                ]}
                onPress={() => {
                  onSelectDate(addDays(today, -7));
                  setShowDatePickerModal(false);
                }}
              >
                <Ionicons
                  name="time-outline"
                  size={16}
                  color={selectedDate === addDays(today, -7) ? C.onAccent : C.text}
                />
                <Txt
                  size="sm"
                  weight="700"
                  color={selectedDate === addDays(today, -7) ? C.onAccent : C.text}
                >
                  1 Week Ago
                </Txt>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  wrapper: {
    backgroundColor: C.bg,
    paddingTop: 4,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  dateTitleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rightControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  todayJumpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: C.accentSoft,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.accent + '35',
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceHi,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  phaseBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.accentSoft,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.accent + '40',
  },
  pulseDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.accent,
  },
  stripContainer: {
    width: '100%',
    alignItems: 'center',
  },
  weekPage: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  dayColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  selectedDot: {
    width: 3.5,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: 'transparent',
    marginBottom: 3,
  },
  selectedDotActive: {
    backgroundColor: '#FFFFFF',
  },
  dayLabelText: {
    fontSize: 11,
    letterSpacing: 0.2,
    marginBottom: 4,
  },
  statusCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusCircleLogged: {
    backgroundColor: '#1E2736',
    borderWidth: 1.5,
    borderColor: '#38475B',
  },
  statusCircleEmpty: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#3B485A',
  },
  statusCircleSelected: {
    borderColor: '#FFFFFF',
    borderWidth: 1.5,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalSheet: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: C.border,
    gap: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalQuickActions: {
    gap: 10,
  },
  quickDateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.surfaceHi,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  quickDateBtnActive: {
    backgroundColor: C.accent,
    borderColor: C.accent,
  },
});
