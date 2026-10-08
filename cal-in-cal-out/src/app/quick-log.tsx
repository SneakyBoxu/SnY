import React, { useMemo, useState } from 'react';
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
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { C } from '@/constants/theme';
import { addDays, formatDayLabel, todayISO } from '@/lib/date';
import { fmtInt, fmtNum, parseNumber } from '@/lib/num';
import { MEAL_TYPES, type MealType } from '@/lib/types';
import { useDb } from '@/db/db';
import { recalculateAll } from '@/db/recalc';
import { createFood, getSettings, guessMealType, insertMealEntry } from '@/db/queries';
import {
  Button,
  Card,
  CardTitle,
  Divider,
  NumberField,
  Screen,
  Txt,
} from '@/components/ui';
import { parseMealTextWithAi, VisionFoodItem } from '@/services/geminiVision';

export default function QuickLogScreen() {
  const db = useDb();
  const params = useLocalSearchParams<{ mealType?: string; date?: string }>();

  const [date, setDate] = useState<string>(params.date ?? todayISO());
  const [mealType, setMealType] = useState<MealType>(
    (params.mealType as MealType) ?? guessMealType(),
  );

  const [textInput, setTextInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [editableItems, setEditableItems] = useState<VisionFoodItem[]>([]);
  const [savingLogs, setSavingLogs] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Edit item modal
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editGramsStr, setEditGramsStr] = useState('');
  const [editKcalStr, setEditKcalStr] = useState('');
  const [editProteinStr, setEditProteinStr] = useState('');
  const [editCarbsStr, setEditCarbsStr] = useState('');
  const [editFatStr, setEditFatStr] = useState('');

  const handleRunAiParse = async () => {
    const clean = textInput.trim();
    if (!clean) {
      setErrorMsg('Please describe the food items and portions first.');
      return;
    }

    setAnalyzing(true);
    setErrorMsg(null);

    try {
      const settings = await getSettings(db);
      const result = await parseMealTextWithAi(clean, settings.gemini_api_key);
      setEditableItems(result.items);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not parse meal. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  };

  const openEditModal = (index: number) => {
    const item = editableItems[index];
    if (!item) return;
    setEditingIdx(index);
    setEditName(item.food_name);
    setEditGramsStr(String(item.estimated_grams));
    setEditKcalStr(String(item.calories_per_100g));
    setEditProteinStr(String(item.protein_per_100g));
    setEditCarbsStr(String(item.carbs_per_100g));
    setEditFatStr(String(item.fat_per_100g));
  };

  const saveEditedItem = () => {
    if (editingIdx === null) return;
    const g = parseNumber(editGramsStr) ?? 100;
    const kcal = parseNumber(editKcalStr) ?? 0;
    const p = parseNumber(editProteinStr) ?? 0;
    const c = parseNumber(editCarbsStr) ?? 0;
    const f = parseNumber(editFatStr) ?? 0;

    setEditableItems((prev) => {
      const updated = [...prev];
      updated[editingIdx] = {
        food_name: editName.trim() || updated[editingIdx].food_name,
        estimated_grams: Math.max(1, g),
        calories_per_100g: Math.max(0, kcal),
        protein_per_100g: Math.max(0, p),
        carbs_per_100g: Math.max(0, c),
        fat_per_100g: Math.max(0, f),
      };
      return updated;
    });
    setEditingIdx(null);
  };

  const updateItemGrams = (index: number, newGramsStr: string) => {
    const grams = parseNumber(newGramsStr) ?? 0;
    setEditableItems((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], estimated_grams: Math.max(0, grams) };
      return updated;
    });
  };

  const removeItem = (index: number) => {
    setEditableItems((prev) => prev.filter((_, i) => i !== index));
    if (editingIdx === index) setEditingIdx(null);
  };

  // Computed totals
  const totals = useMemo(() => {
    let calories = 0;
    let protein = 0;
    let carbs = 0;
    let fat = 0;

    for (const item of editableItems) {
      const r = item.estimated_grams / 100;
      calories += item.calories_per_100g * r;
      protein += item.protein_per_100g * r;
      carbs += item.carbs_per_100g * r;
      fat += item.fat_per_100g * r;
    }

    return {
      calories: Math.round(calories),
      protein: Math.round(protein * 10) / 10,
      carbs: Math.round(carbs * 10) / 10,
      fat: Math.round(fat * 10) / 10,
    };
  }, [editableItems]);

  const handleCommitPlateLog = async () => {
    if (editableItems.length === 0) return;
    setSavingLogs(true);
    try {
      for (const item of editableItems) {
        if (item.estimated_grams <= 0) continue;
        let foodId: number | null = null;
        try {
          foodId = await createFood(db, {
            food_name: item.food_name,
            calories_per_100g: item.calories_per_100g,
            protein_per_100g: item.protein_per_100g,
            carbs_per_100g: item.carbs_per_100g,
            fat_per_100g: item.fat_per_100g,
            category: 'AI Quick Log',
          });
        } catch {
          // Food exists
        }

        const r = item.estimated_grams / 100;
        await insertMealEntry(db, {
          date,
          mealType,
          foodName: item.food_name,
          grams: item.estimated_grams,
          calories: Math.round(item.calories_per_100g * r),
          protein: Math.round(item.protein_per_100g * r * 10) / 10,
          carbs: Math.round(item.carbs_per_100g * r * 10) / 10,
          fat: Math.round(item.fat_per_100g * r * 10) / 10,
          foodId,
          per100: {
            calories: item.calories_per_100g,
            protein: item.protein_per_100g,
            carbs: item.carbs_per_100g,
            fat: item.fat_per_100g,
          },
        });
      }

      await recalculateAll(db);
      router.back();
    } catch (e: any) {
      alert(`Error saving meal: ${e.message}`);
    } finally {
      setSavingLogs(false);
    }
  };

  return (
    <Screen
      title="AI Quick Log"
      subtitle="Text-based natural language macro estimation"
      onBack={() => router.back()}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ gap: 14, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* 1. INPUT CARD */}
        <Card highlight style={{ padding: 16, gap: 12 }}>
          <View style={{ gap: 6 }}>
            <Txt size="xs" weight="800" color={C.dimmer} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Describe What You Ate
            </Txt>
            <View style={st.textAreaContainer}>
              <TextInput
                value={textInput}
                onChangeText={setTextInput}
                multiline
                numberOfLines={3}
                placeholder="e.g. 220 gram of white rice, 340 gram of pork steak, 1 fried egg with 1 tbsp oil"
                placeholderTextColor={C.dimmer}
                style={st.textAreaInput}
              />
            </View>
          </View>

          <Button
            title={analyzing ? 'Calculating with AI…' : 'Calculate & Breakdown'}
            onPress={handleRunAiParse}
            disabled={analyzing || !textInput.trim()}
          />
        </Card>

        {/* 2. ERROR / FEEDBACK */}
        {errorMsg ? (
          <Card style={{ borderColor: C.danger, borderWidth: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="alert-circle" size={18} color={C.danger} />
              <Txt size="sm" color={C.danger} weight="700" style={{ flex: 1 }}>
                {errorMsg}
              </Txt>
            </View>
          </Card>
        ) : null}

        {/* 3. LOADING INDICATOR */}
        {analyzing ? (
          <Card style={{ padding: 24, alignItems: 'center', gap: 12 }}>
            <ActivityIndicator size="large" color={C.accent} />
            <Txt size="md" weight="800" color={C.text}>
              Parsing Foods & Portion Weights…
            </Txt>
            <Txt size="xs" color={C.dim} align="center">
              Gemini AI is referencing nutritional databases to estimate accurate grams and macros.
            </Txt>
          </Card>
        ) : null}

        {/* 4. IDENTIFIED PLATE BREAKDOWN (Matches Meal Scan UI) */}
        {editableItems.length > 0 ? (
          <>
            <Card highlight style={{ padding: 16, gap: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <CardTitle icon={<Ionicons name="sparkles" size={16} color={C.accent} />}>
                  PLATE BREAKDOWN ({editableItems.length} ITEMS)
                </CardTitle>
              </View>

              {editableItems.map((item, idx) => {
                const r = item.estimated_grams / 100;
                const itemKcal = Math.round(item.calories_per_100g * r);
                const itemP = Math.round(item.protein_per_100g * r * 10) / 10;
                const itemC = Math.round(item.carbs_per_100g * r * 10) / 10;
                const itemF = Math.round(item.fat_per_100g * r * 10) / 10;

                return (
                    <View key={`${item.food_name}-${idx}`}>
                      {idx > 0 ? <Divider /> : null}
                      <View style={st.componentRow}>
                        <Pressable
                          onPress={() => openEditModal(idx)}
                          style={({ pressed }) => [{ flex: 1, gap: 4 }, pressed && { opacity: 0.7 }]}
                        >
                          <Txt size="md" weight="800" color={C.text}>
                            {item.food_name}
                          </Txt>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Txt size="xs" weight="700" color={C.protein}>{`${itemP}P`}</Txt>
                            <Txt size="xs" color={C.dimmer}>•</Txt>
                            <Txt size="xs" weight="700" color={C.carbs}>{`${itemC}C`}</Txt>
                            <Txt size="xs" color={C.dimmer}>•</Txt>
                            <Txt size="xs" weight="700" color={C.fat}>{`${itemF}F`}</Txt>
                          </View>
                        </Pressable>

                        {/* Controls: Compact Grams Box, Calorie Badge, Trash */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View style={st.gramsEditBox}>
                            <TextInput
                              value={String(item.estimated_grams)}
                              onChangeText={(v) => updateItemGrams(idx, v.replace(/[^0-9]/g, ''))}
                              keyboardType="numeric"
                              style={{
                                color: C.accent,
                                fontSize: 15,
                                fontWeight: '800',
                                textAlign: 'right',
                                width: 44,
                                paddingVertical: 2,
                                paddingHorizontal: 0,
                                outlineStyle: 'none',
                              } as any}
                            />
                            <Txt size="xs" weight="800" color={C.dim}>
                              g
                            </Txt>
                          </View>

                          <Pressable
                            onPress={() => openEditModal(idx)}
                            style={st.itemKcalBadge}
                          >
                            <Txt size="sm" weight="800" color={C.kcal}>
                              {`${itemKcal} kcal`}
                            </Txt>
                          </Pressable>

                          <Pressable
                            onPress={() => removeItem(idx)}
                            style={({ pressed }) => [st.removeIconBtn, pressed && { opacity: 0.7 }]}
                          >
                            <Ionicons name="trash-outline" size={15} color={C.dimmer} />
                          </Pressable>
                        </View>
                      </View>
                    </View>
                );
              })}

              <Divider />

              {/* Total Summary Macro Pills Grid */}
              <View style={st.macroGrid}>
                <View style={st.macroBox}>
                  <Txt size="xs" weight="800" color={C.kcal}>
                    KCAL
                  </Txt>
                  <Txt size="lg" weight="900" color={C.kcal}>
                    {fmtInt(totals.calories)}
                  </Txt>
                </View>

                <View style={st.macroBox}>
                  <Txt size="xs" weight="800" color={C.protein}>
                    PROTEIN
                  </Txt>
                  <Txt size="lg" weight="900" color={C.protein}>
                    {`${fmtNum(totals.protein)}g`}
                  </Txt>
                </View>

                <View style={st.macroBox}>
                  <Txt size="xs" weight="800" color={C.carbs}>
                    CARBS
                  </Txt>
                  <Txt size="lg" weight="900" color={C.carbs}>
                    {`${fmtNum(totals.carbs)}g`}
                  </Txt>
                </View>

                <View style={st.macroBox}>
                  <Txt size="xs" weight="800" color={C.fat}>
                    FAT
                  </Txt>
                  <Txt size="lg" weight="900" color={C.fat}>
                    {`${fmtNum(totals.fat)}g`}
                  </Txt>
                </View>
              </View>
            </Card>

            {/* 5. LOG DESTINATION SELECTOR */}
            <Card style={{ padding: 16, gap: 14 }}>
              <CardTitle icon={<Ionicons name="time-outline" size={16} color={C.dim} />}>
                LOG TO MEAL &amp; DATE
              </CardTitle>

              {/* Meal Category Pills */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {MEAL_TYPES.map((t) => {
                  const active = mealType === t;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => setMealType(t)}
                      style={[st.mealChoicePill, active && st.mealChoicePillActive]}
                    >
                      <Txt size="xs" weight="800" color={active ? C.onAccent : C.text}>
                        {t}
                      </Txt>
                    </Pressable>
                  );
                })}
              </View>

              {/* Date Quick Jump Pills */}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {[
                  { label: 'Today', iso: todayISO() },
                  { label: 'Yesterday', iso: addDays(todayISO(), -1) },
                  { label: '2 days ago', iso: addDays(todayISO(), -2) },
                ].map((d) => {
                  const active = date === d.iso;
                  return (
                    <Pressable
                      key={d.label}
                      onPress={() => setDate(d.iso)}
                      style={[st.dateChoicePill, active && st.dateChoicePillActive]}
                    >
                      <Txt size="xs" weight="700" color={active ? C.onAccent : C.dim}>
                        {d.label}
                      </Txt>
                    </Pressable>
                  );
                })}
              </View>

              <Button
                title={savingLogs ? 'Logging Plate to Diary…' : `Log Plate to ${mealType}`}
                onPress={handleCommitPlateLog}
                disabled={savingLogs}
              />
            </Card>
          </>
        ) : null}
      </ScrollView>

      {/* Edit Component Modal */}
      <Modal
        visible={editingIdx !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingIdx(null)}
      >
        <Pressable style={st.modalOverlay} onPress={() => setEditingIdx(null)}>
          <Pressable style={st.modalCard} onPress={(e) => e.stopPropagation?.()}>
            <View style={{ gap: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Txt size="lg" weight="900" color={C.text}>
                  Edit Food Component
                </Txt>
                <Pressable onPress={() => setEditingIdx(null)} style={{ padding: 4 }}>
                  <Ionicons name="close" size={20} color={C.dim} />
                </Pressable>
              </View>

              <NumberField
                label="Food Name"
                value={editName}
                onChangeText={setEditName}
                placeholder="e.g. Pork Steak, White Rice…"
              />

              <NumberField
                label="Portion Weight (Grams)"
                value={editGramsStr}
                onChangeText={setEditGramsStr}
                suffix="g"
                placeholder="100"
              />

              <Txt size="xs" weight="700" color={C.dimmer} style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                Nutritional Values (Per 100g)
              </Txt>

              <View style={{ flexDirection: 'row', gap: 8 }}>
                <NumberField
                  label="Calories"
                  value={editKcalStr}
                  onChangeText={setEditKcalStr}
                  placeholder="130"
                  style={{ flex: 1 }}
                />
                <NumberField
                  label="Protein"
                  value={editProteinStr}
                  onChangeText={setEditProteinStr}
                  placeholder="16"
                  style={{ flex: 1 }}
                />
              </View>

              <View style={{ flexDirection: 'row', gap: 8 }}>
                <NumberField
                  label="Carbs"
                  value={editCarbsStr}
                  onChangeText={setEditCarbsStr}
                  placeholder="3"
                  style={{ flex: 1 }}
                />
                <NumberField
                  label="Fat"
                  value={editFatStr}
                  onChangeText={setEditFatStr}
                  placeholder="14"
                  style={{ flex: 1 }}
                />
              </View>

              <Divider />

              <View style={{ gap: 8 }}>
                <Button title="Apply Changes" onPress={saveEditedItem} />
                <Button
                  title="Remove Food from Plate"
                  variant="danger"
                  onPress={() => {
                    if (editingIdx !== null) removeItem(editingIdx);
                  }}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const st = StyleSheet.create({
  textAreaContainer: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
  },
  textAreaInput: {
    color: C.text,
    fontSize: 14,
    fontWeight: '500',
    minHeight: 64,
    textAlignVertical: 'top',
    padding: 0,
    outlineStyle: 'none',
  } as any,
  componentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 8,
  },
  gramsEditBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceHi,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: C.border,
    gap: 2,
  },
  itemKcalBadge: {
    backgroundColor: C.blueSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  removeIconBtn: {
    padding: 6,
  },
  macroGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  macroBox: {
    flex: 1,
    backgroundColor: C.surfaceAlt,
    padding: 10,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
    gap: 2,
  },
  mealChoicePill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.border,
  },
  mealChoicePillActive: {
    backgroundColor: C.accent,
    borderColor: C.accent,
  },
  dateChoicePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.border,
  },
  dateChoicePillActive: {
    backgroundColor: C.accent,
    borderColor: C.accent,
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
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
});
