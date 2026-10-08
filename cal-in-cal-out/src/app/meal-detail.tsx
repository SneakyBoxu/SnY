import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle } from 'react-native-svg';

import { C } from '@/constants/theme';
import { useDb } from '@/db/db';
import { deleteMealEntry, listMealEntries } from '@/db/queries';
import { recalculateAll } from '@/db/recalc';
import { addDays, fromISODate, todayISO } from '@/lib/date';
import { fmtInt, fmtNum } from '@/lib/num';
import { MEAL_TYPES, type MealEntry, type MealType } from '@/lib/types';
import { Button, Card, ConfirmModal, Screen, Txt } from '@/components/ui';

export default function MealDetailScreen() {
  const db = useDb();
  const params = useLocalSearchParams<{ date?: string }>();

  const today = todayISO();
  const [selectedDate, setSelectedDate] = useState<string>(params.date || today);
  const [allEntries, setAllEntries] = useState<MealEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTargetEntry, setDeleteTargetEntry] = useState<MealEntry | null>(null);

  const loadEntries = useCallback(
    async (targetDate: string) => {
      setLoading(true);
      const list = await listMealEntries(db, targetDate);
      setAllEntries(list);
      setLoading(false);
    },
    [db],
  );

  useFocusEffect(
    useCallback(() => {
      loadEntries(selectedDate);
    }, [loadEntries, selectedDate]),
  );

  const onDeleteEntry = (entry: MealEntry) => {
    setDeleteTargetEntry(entry);
  };

  const handleConfirmDeleteEntry = async () => {
    if (!deleteTargetEntry) return;
    const entry = deleteTargetEntry;
    setDeleteTargetEntry(null);
    await deleteMealEntry(db, entry.id);
    await recalculateAll(db);
    loadEntries(selectedDate);
  };

  // Header date display
  const dateTitle = useMemo(() => {
    if (selectedDate === today) return 'Today';
    if (selectedDate === addDays(today, -1)) return 'Yesterday';
    if (selectedDate === addDays(today, 1)) return 'Tomorrow';
    const d = fromISODate(selectedDate);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }, [selectedDate, today]);

  // Daily totals across all meals
  const totalCals = allEntries.reduce((s, e) => s + e.calories, 0);
  const totalP = allEntries.reduce((s, e) => s + e.protein, 0);
  const totalC = allEntries.reduce((s, e) => s + e.carbs, 0);
  const totalF = allEntries.reduce((s, e) => s + e.fat, 0);

  // Macro calorie ratios
  const calFromP = totalP * 4;
  const calFromC = totalC * 4;
  const calFromF = totalF * 9;
  const macroCalSum = calFromP + calFromC + calFromF;

  const pctP = macroCalSum > 0 ? Math.round((calFromP / macroCalSum) * 100) : 0;
  const pctC = macroCalSum > 0 ? Math.round((calFromC / macroCalSum) * 100) : 0;
  const pctF =
    macroCalSum > 0 ? Math.max(0, 100 - pctP - pctC) : 0; // Ensures 100% total

  // Donut chart stroke segments
  const ringSize = 130;
  const ringStroke = 12;
  const r = (ringSize - ringStroke) / 2;
  const circ = 2 * Math.PI * r;

  const dashC = macroCalSum > 0 ? (pctC / 100) * circ : 0;
  const dashF = macroCalSum > 0 ? (pctF / 100) * circ : 0;
  const dashP = macroCalSum > 0 ? (pctP / 100) * circ : 0;

  const offsetC = 0;
  const offsetF = -dashC;
  const offsetP = -(dashC + dashF);

  // Group entries by meal type
  const entriesByMeal = useMemo(() => {
    const map = new Map<MealType, MealEntry[]>();
    for (const t of MEAL_TYPES) {
      map.set(t, []);
    }
    for (const e of allEntries) {
      const list = map.get(e.meal_type) ?? [];
      list.push(e);
      map.set(e.meal_type, list);
    }
    return map;
  }, [allEntries]);

  return (
    <Screen
      customHeader={
        <View style={st.headerBar}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [st.iconBtn, pressed && { opacity: 0.6 }]}
            hitSlop={10}
          >
            <Ionicons name="arrow-back" size={22} color={C.text} />
          </Pressable>

          <View style={st.dateSwitcher}>
            <Pressable
              onPress={() => setSelectedDate((d) => addDays(d, -1))}
              hitSlop={8}
              style={({ pressed }) => [st.navArrow, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="chevron-back" size={18} color={C.dim} />
            </Pressable>

            <View style={st.dateLabelGroup}>
              <Txt size="lg" weight="900" color={C.text}>
                {dateTitle}
              </Txt>
              <Ionicons name="chevron-down" size={14} color={C.dim} style={{ marginTop: 2 }} />
            </View>

            <Pressable
              onPress={() => setSelectedDate((d) => addDays(d, 1))}
              hitSlop={8}
              style={({ pressed }) => [st.navArrow, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="chevron-forward" size={18} color={C.dim} />
            </Pressable>
          </View>

          <View style={{ width: 28 }} />
        </View>
      }
    >
      {/* 1. TOP MACRO DONUT & RATIO SUMMARY CARD */}
      <Card highlight style={st.summaryCard}>
        {/* Left: Multi-color macro donut */}
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: ringSize, height: ringSize, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={ringSize} height={ringSize}>
              {/* Background ring */}
              <Circle
                cx={ringSize / 2}
                cy={ringSize / 2}
                r={r}
                stroke={C.surfaceHi}
                strokeWidth={ringStroke}
                fill="none"
              />
              {/* Carbs Segment (Cyan / Teal) */}
              {dashC > 0 ? (
                <Circle
                  cx={ringSize / 2}
                  cy={ringSize / 2}
                  r={r}
                  stroke={C.carbs}
                  strokeWidth={ringStroke}
                  fill="none"
                  strokeDasharray={`${dashC} ${circ}`}
                  strokeDashoffset={offsetC}
                />
              ) : null}
              {/* Fat Segment (Purple / Magenta) */}
              {dashF > 0 ? (
                <Circle
                  cx={ringSize / 2}
                  cy={ringSize / 2}
                  r={r}
                  stroke={C.fat}
                  strokeWidth={ringStroke}
                  fill="none"
                  strokeDasharray={`${dashF} ${circ}`}
                  strokeDashoffset={offsetF}
                />
              ) : null}
              {/* Protein Segment (Orange / Gold) */}
              {dashP > 0 ? (
                <Circle
                  cx={ringSize / 2}
                  cy={ringSize / 2}
                  r={r}
                  stroke={C.protein}
                  strokeWidth={ringStroke}
                  fill="none"
                  strokeDasharray={`${dashP} ${circ}`}
                  strokeDashoffset={offsetP}
                />
              ) : null}
            </Svg>

            <View style={st.donutCenter}>
              <Txt size="xxl" weight="900" color={C.text} style={{ letterSpacing: -0.6 }}>
                {fmtInt(totalCals)}
              </Txt>
              <Txt size="xs" weight="700" color={C.dim}>
                cal
              </Txt>
            </View>
          </View>
        </View>

        {/* Right: Macro % and Gram Readouts */}
        <View style={st.macroReadoutRow}>
          {/* Carbs */}
          <View style={st.macroStatCol}>
            <Txt size="xs" weight="800" color={C.carbs}>
              {`${pctC}%`}
            </Txt>
            <Txt size="lg" weight="900" color={C.text}>
              {`${fmtInt(totalC)}g`}
            </Txt>
            <Txt size="xs" color={C.dimmer} weight="600">
              Carbs
            </Txt>
          </View>

          {/* Fat */}
          <View style={st.macroStatCol}>
            <Txt size="xs" weight="800" color={C.fat}>
              {`${pctF}%`}
            </Txt>
            <Txt size="lg" weight="900" color={C.text}>
              {`${fmtInt(totalF)}g`}
            </Txt>
            <Txt size="xs" color={C.dimmer} weight="600">
              Fat
            </Txt>
          </View>

          {/* Protein */}
          <View style={st.macroStatCol}>
            <Txt size="xs" weight="800" color={C.protein}>
              {`${pctP}%`}
            </Txt>
            <Txt size="lg" weight="900" color={C.text}>
              {`${fmtInt(totalP)}g`}
            </Txt>
            <Txt size="xs" color={C.dimmer} weight="600">
              Protein
            </Txt>
          </View>
        </View>
      </Card>

      {/* 2. ALL MEAL CARDS (BREAKFAST, LUNCH, DINNER, SNACKS) */}
      <View style={{ gap: 12 }}>
        {MEAL_TYPES.map((type) => {
          const items = entriesByMeal.get(type) ?? [];
          const mealCals = items.reduce((s, e) => s + e.calories, 0);

          return (
            <Card key={type} style={{ padding: 14 }}>
              {/* Header row: Meal name + Calorie subtotal (or empty) + Log button */}
              <View style={st.mealCardHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Txt size="md" weight="900" color={C.text}>
                    {type === 'Snack' ? 'Snacks' : type}
                  </Txt>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  {mealCals > 0 ? (
                    <Txt size="sm" weight="900" color={C.text}>
                      {`${fmtInt(mealCals)} cal`}
                    </Txt>
                  ) : null}

                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: '/log-food' as any,
                        params: { mealType: type, date: selectedDate },
                      })
                    }
                    style={st.pillLogBtn}
                  >
                    <Txt size="xs" weight="800" color="#FFFFFF">
                      {items.length > 0 ? 'Log more' : 'Log food'}
                    </Txt>
                  </Pressable>
                </View>
              </View>

              {/* Food Items List */}
              {items.length > 0 ? (
                <View style={{ gap: 8, marginTop: 10 }}>
                  {items.map((item) => (
                    <View key={item.id} style={st.foodRow}>
                      <Pressable
                        onPress={() =>
                          router.push({
                            pathname: '/add-entry',
                            params: { entryId: String(item.id) },
                          })
                        }
                        style={({ pressed }) => [st.foodInfoCol, pressed && { opacity: 0.7 }]}
                      >
                        <Txt
                          size="sm"
                          weight="700"
                          color={C.text}
                          numberOfLines={2}
                          style={st.foodNameText}
                        >
                          {item.food_name}
                        </Txt>
                        <Txt size="xs" color={C.dim} weight="500" style={st.foodSubText}>
                          {item.serving_grams ? `${fmtNum(item.serving_grams)}g` : 'Serving logged'}
                          {` • ${fmtInt(item.protein)}P ${fmtInt(item.carbs)}C ${fmtInt(item.fat)}F`}
                        </Txt>
                      </Pressable>

                      <View style={st.foodRightAction}>
                        <Txt size="sm" weight="800" color={C.text} style={st.foodCalText}>
                          {fmtInt(item.calories)}
                        </Txt>
                        <Pressable
                          onPress={() => onDeleteEntry(item)}
                          hitSlop={8}
                          style={({ pressed }) => [st.trashBtn, pressed && { opacity: 0.6 }]}
                        >
                          <Ionicons name="trash-outline" size={13} color={C.dimmer} />
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </Card>
          );
        })}
      </View>

      {/* Delete Food Entry Confirmation Modal */}
      <ConfirmModal
        visible={Boolean(deleteTargetEntry)}
        title="Delete Food Entry?"
        message={`Are you sure you want to delete "${deleteTargetEntry?.food_name}" from your diary?`}
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
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dateLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  navArrow: {
    padding: 4,
  },
  summaryCard: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 4,
  },
  donutCenter: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  macroReadoutRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  macroStatCol: {
    alignItems: 'center',
    gap: 2,
  },
  mealCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pillLogBtn: {
    backgroundColor: '#1E60D5',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foodRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border + '60',
  },
  foodInfoCol: {
    flex: 1,
    gap: 2,
    paddingRight: 12,
  },
  foodNameText: {
    fontSize: 13,
    lineHeight: 18,
  },
  foodSubText: {
    fontSize: 11,
  },
  foodCalText: {
    fontSize: 13,
  },
  foodRightAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  trashBtn: {
    padding: 4,
  },
});
