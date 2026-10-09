import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { C } from '@/constants/theme';
import { addDays, formatDayLabel, todayISO } from '@/lib/date';
import { fmtInt, fmtNum, parseNumber } from '@/lib/num';
import { MEAL_TYPES, type Food, type MealType } from '@/lib/types';
import { useDb } from '@/db/db';
import { recalculateAll } from '@/db/recalc';
import {
  createFood,
  deleteMealEntry,
  getFood,
  getMealEntry,
  guessMealType,
  insertMealEntry,
  searchFoods,
  updateMealEntry,
} from '@/db/queries';
import {
  Button,
  Card,
  CardTitle,
  Chip,
  ChipRow,
  Divider,
  NumberField,
  Screen,
  TextField,
  Txt,
} from '@/components/ui';
import { OpenFoodFactsProduct, searchOpenFoodFacts } from '@/services/openFoodFacts';
import {
  calculateNutrition,
  foodToFoodItem,
  type CalculatedNutrition,
  type FoodItem,
} from '@/lib/nutrition';

interface Per100 {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface UnitOption {
  id: string;
  label: string;
  short: string;
  grams: number;
}

const STANDARD_UNIT_OPTIONS: UnitOption[] = [
  { id: 'can', label: 'Can (155g)', short: 'can', grams: 155 },
  { id: 'pack', label: 'Pack / Bag (110g)', short: 'pack', grams: 110 },
  { id: 'snack_pack', label: 'Small Snack Pack (28g)', short: 'pack', grams: 28 },
  { id: 'sachet', label: 'Sachet / 3-in-1 (30g)', short: 'sachet', grams: 30 },
  { id: 'piece_candy', label: 'Piece / Candy (3.5g)', short: 'pc', grams: 3.5 },
  { id: 'egg', label: 'Whole Egg (50g)', short: 'egg', grams: 50 },
  { id: 'scoop', label: 'Scoop (30g)', short: 'scoop', grams: 30 },
  { id: 'slice', label: 'Slice (28g)', short: 'slice', grams: 28 },
  { id: 'tbsp', label: 'Tablespoon (15g)', short: 'tbsp', grams: 15 },
  { id: 'cup', label: 'Cup (240g)', short: 'cup', grams: 240 },
  { id: 'custom', label: 'Custom Serving Size…', short: 'serving', grams: 50 },
];

const POPULAR_FOODS = [
  'Cooked White Rice',
  'Chicken Breast (Cooked)',
  'Whole Egg (Boiled/Fried)',
  'Century Tuna in Oil',
  'Whey Protein Powder',
  'Rolled Oats',
  'Banana',
];

export default function AddEntryScreen() {
  const db = useDb();
  const params = useLocalSearchParams<{
    entryId?: string;
    foodId?: string;
    mealType?: string;
    date?: string;
  }>();

  // Extract primitives so effects don't re-run on every render (params object identity is unstable on web)
  const entryIdParam = params.entryId;
  const foodIdParam = params.foodId;
  const dateParam = params.date;

  const editing = params.entryId !== undefined;
  const [entryId, setEntryId] = useState<number | null>(null);
  const [date, setDate] = useState<string>(dateParam ?? todayISO());
  const [mealType, setMealType] = useState<MealType>(
    (params.mealType as MealType) ?? guessMealType(),
  );
  const [name, setName] = useState('');
  const [per100, setPer100] = useState<Per100 | null>(null);
  const [foodItem, setFoodItem] = useState<FoodItem | null>(null);
  const [foodId, setFoodId] = useState<number | null>(null);

  // Unit Dropdown & Quantity state
  const [selectedUnitId, setSelectedUnitId] = useState<string>('g');
  const [amountStr, setAmountStr] = useState('100');
  const [customUnitGramsStr, setCustomUnitGramsStr] = useState('50');
  const [showUnitPickerModal, setShowUnitPickerModal] = useState(false);

  // Raw manual mode
  const [kcalStr, setKcalStr] = useState('');
  const [pStr, setPStr] = useState('');
  const [cStr, setCStr] = useState('');
  const [fStr, setFStr] = useState('');
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Search Food Picker state
  const [foodSearchQuery, setFoodSearchQuery] = useState('');
  const [foodSearchResults, setFoodSearchResults] = useState<Food[]>([]);
  const [openFoodResults, setOpenFoodResults] = useState<OpenFoodFactsProduct[]>([]);
  const [isSearchingOnline, setIsSearchingOnline] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [manualMode, setManualMode] = useState(false);

  /**
   * Smart Serving Size Initialization:
   * Sets default unit and portion according to the item's native serving:
   * - If native serving weight exists and != 100g: defaults to 1 Native Serving (e.g. 1 Stick (1.9g))
   * - If bulk ingredient: defaults to Grams (Scale Weight) with 100g
   */
  const applyFoodPortionDefaults = (item: FoodItem, explicitGrams?: number | null) => {
    setFoodItem(item);
    setName(item.name);
    const r100 = 100 / item.baseWeightGrams;
    setPer100({
      calories: Math.round(item.baseCalories * r100),
      protein: Math.round(item.baseProtein * r100 * 10) / 10,
      carbs: Math.round(item.baseCarbs * r100 * 10) / 10,
      fat: Math.round(item.baseFat * r100 * 10) / 10,
    });
    setManualMode(false);
    setIsPickerOpen(false);
    setFoodSearchQuery('');

    const hasNativeServing =
      Boolean(item.servingUnitName) &&
      item.baseWeightGrams > 0 &&
      Math.abs(item.baseWeightGrams - 100) > 0.01;

    if (hasNativeServing) {
      setSelectedUnitId('serving');
      if (explicitGrams !== undefined && explicitGrams !== null && explicitGrams > 0) {
        const qty = Math.round((explicitGrams / item.baseWeightGrams) * 10) / 10;
        setAmountStr(String(qty > 0 ? qty : 1));
      } else {
        setAmountStr('1');
      }
    } else {
      setSelectedUnitId('g');
      if (explicitGrams !== undefined && explicitGrams !== null && explicitGrams > 0) {
        setAmountStr(String(Math.round(explicitGrams * 10) / 10));
      } else {
        setAmountStr('100');
      }
    }
  };

  useEffect(() => {
    // Run only once per navigation (deps are stable primitives, not the params object)
    let live = true;
    (async () => {
      if (entryIdParam !== undefined) {
        const entry = await getMealEntry(db, Number(entryIdParam));
        if (!entry || !live) return;
        setEntryId(entry.id);
        setDate(entry.date);
        setMealType(entry.meal_type);
        setName(entry.food_name);
        setFoodId(entry.food_id);

        if (entry.food_id) {
          const food = await getFood(db, entry.food_id);
          if (food && live) {
            const item = foodToFoodItem(food);
            applyFoodPortionDefaults(item, entry.serving_grams);
            if (live) setReady(true);
            return;
          }
        }

        if (
          entry.per100_calories !== null &&
          entry.per100_protein !== null &&
          entry.per100_carbs !== null &&
          entry.per100_fat !== null
        ) {
          const item = foodToFoodItem({
            food_name: entry.food_name,
            calories_per_100g: entry.per100_calories,
            protein_per_100g: entry.per100_protein,
            carbs_per_100g: entry.per100_carbs,
            fat_per_100g: entry.per100_fat,
          });
          applyFoodPortionDefaults(item, entry.serving_grams);
        } else {
          setManualMode(true);
          setSelectedUnitId('g');
          setAmountStr(entry.serving_grams !== null ? String(entry.serving_grams) : '100');
          setKcalStr(String(Math.round(entry.calories)));
          setPStr(String(Math.round(entry.protein)));
          setCStr(String(Math.round(entry.carbs)));
          setFStr(String(Math.round(entry.fat)));
        }
      } else if (foodIdParam !== undefined) {
        const food = await getFood(db, Number(foodIdParam));
        if (!food || !live) return;
        setFoodId(food.id);
        const item = foodToFoodItem(food);
        applyFoodPortionDefaults(item);
      } else {
        setIsPickerOpen(true);
      }
      if (live) setReady(true);
    })();
    return () => {
      live = false;
    };
  }, [db, entryIdParam, foodIdParam, dateParam]);

  // Live Food Search effect
  useEffect(() => {
    let active = true;
    if (isPickerOpen) {
      const clean = foodSearchQuery.trim();
      const run = async () => {
        const results = clean
          ? await searchFoods(db, clean, null, 15)
          : await searchFoods(db, '', null, 10);
        if (active) {
          setFoodSearchResults(results);
        }
      };
      run();
    }
    return () => {
      active = false;
    };
  }, [db, isPickerOpen, foodSearchQuery]);

  const triggerOnlineFoodSearch = async (queryStr: string) => {
    const q = queryStr.trim();
    if (!q || q.length < 2) return;
    setIsSearchingOnline(true);
    try {
      const results = await searchOpenFoodFacts(q);
      setOpenFoodResults(results);
    } catch {
      setOpenFoodResults([]);
    } finally {
      setIsSearchingOnline(false);
    }
  };

  const selectLocalFood = (food: Food) => {
    setFoodId(food.id);
    const item = foodToFoodItem(food);
    applyFoodPortionDefaults(item);
  };

  const selectOnlineFood = async (product: OpenFoodFactsProduct) => {
    const displayName = product.brand ? `${product.brand} - ${product.name}` : product.name;
    try {
      const newId = await createFood(db, {
        food_name: displayName,
        calories_per_100g: product.caloriesPer100g,
        protein_per_100g: product.proteinPer100g,
        carbs_per_100g: product.carbsPer100g,
        fat_per_100g: product.fatPer100g,
        category: product.category || 'Packaged & Grocery',
        barcode: product.barcode || undefined,
        serving_weight_grams: product.servingWeightGrams,
        serving_unit_name: product.servingUnitName,
      });

      setFoodId(newId);
      const item = foodToFoodItem(
        {
          food_name: displayName,
          calories_per_100g: product.caloriesPer100g,
          protein_per_100g: product.proteinPer100g,
          carbs_per_100g: product.carbsPer100g,
          fat_per_100g: product.fatPer100g,
          serving_weight_grams: product.servingWeightGrams,
          serving_unit_name: product.servingUnitName,
        },
        product.servingSize,
      );
      applyFoodPortionDefaults(item);
    } catch {
      const item = foodToFoodItem(
        {
          food_name: displayName,
          calories_per_100g: product.caloriesPer100g,
          protein_per_100g: product.proteinPer100g,
          carbs_per_100g: product.carbsPer100g,
          fat_per_100g: product.fatPer100g,
          serving_weight_grams: product.servingWeightGrams,
          serving_unit_name: product.servingUnitName,
        },
        product.servingSize,
      );
      applyFoodPortionDefaults(item);
    }
  };

  /**
   * Dynamically populate unit options:
   * Injects the food's native serving at the top if defined,
   * followed by Grams (Scale Weight) as the secondary option.
   */
  const unitOptions: UnitOption[] = useMemo(() => {
    const hasNativeServing =
      Boolean(foodItem?.servingUnitName) &&
      (foodItem?.baseWeightGrams ?? 0) > 0 &&
      Math.abs((foodItem?.baseWeightGrams ?? 0) - 100) > 0.01;

    const list: UnitOption[] = [];

    if (hasNativeServing && foodItem) {
      list.push({
        id: 'serving',
        label: `1 ${foodItem.servingUnitName} (${foodItem.baseWeightGrams}g)`,
        short: foodItem.servingUnitName || 'serving',
        grams: foodItem.baseWeightGrams,
      });
      list.push({
        id: 'g',
        label: 'Grams (Scale Weight)',
        short: 'g',
        grams: 1,
      });
    } else {
      list.push({
        id: 'g',
        label: 'Grams (Scale Weight)',
        short: 'g',
        grams: 1,
      });
    }

    for (const u of STANDARD_UNIT_OPTIONS) {
      if (hasNativeServing && foodItem?.servingUnitName?.toLowerCase() === u.short.toLowerCase()) {
        continue;
      }
      list.push(u);
    }

    return list;
  }, [foodItem]);

  const activeUnit = useMemo(() => {
    return unitOptions.find((u) => u.id === selectedUnitId) ?? unitOptions[0];
  }, [unitOptions, selectedUnitId]);

  const unitWeightGrams = useMemo(() => {
    if (activeUnit.id === 'custom') {
      return parseNumber(customUnitGramsStr) ?? 50;
    }
    return activeUnit.grams;
  }, [activeUnit, customUnitGramsStr]);

  /**
   * Reactively calculate displayed macros:
   * Uses calculateNutrition to scale calories & macros proportionally
   */
  const nutrition: CalculatedNutrition | null = useMemo(() => {
    if (!foodItem) return null;
    const qty = parseNumber(amountStr);
    if (qty === null || qty <= 0) return null;

    if (selectedUnitId === 'serving') {
      return calculateNutrition(foodItem, 'SERVING', qty);
    } else if (selectedUnitId === 'g') {
      return calculateNutrition(foodItem, 'GRAMS', qty);
    } else {
      const effGrams = qty * unitWeightGrams;
      const factor = effGrams / foodItem.baseWeightGrams;
      return {
        netGrams: Math.round(effGrams * 10) / 10,
        calories: Math.round(foodItem.baseCalories * factor),
        protein: Math.round(foodItem.baseProtein * factor * 10) / 10,
        carbs: Math.round(foodItem.baseCarbs * factor * 10) / 10,
        fat: Math.round(foodItem.baseFat * factor * 10) / 10,
      };
    }
  }, [foodItem, selectedUnitId, amountStr, unitWeightGrams]);

  const effectiveGrams = useMemo(() => {
    if (nutrition) return nutrition.netGrams;
    const qty = parseNumber(amountStr);
    if (qty === null || qty <= 0) return null;
    return Math.round(qty * unitWeightGrams * 10) / 10;
  }, [nutrition, amountStr, unitWeightGrams]);

  const preview = nutrition;

  const onSelectUnit = (unit: UnitOption) => {
    const prevUnitId = selectedUnitId;
    setSelectedUnitId(unit.id);
    setShowUnitPickerModal(false);

    if (unit.id === 'g') {
      if (prevUnitId === 'serving' && foodItem) {
        // Switching from serving to scale weight: initialize to the serving's scale weight
        const qty = parseNumber(amountStr) ?? 1;
        const targetGrams = Math.round(qty * foodItem.baseWeightGrams * 10) / 10;
        setAmountStr(String(targetGrams));
      } else if (parseNumber(amountStr) === 1 || parseNumber(amountStr) === null) {
        setAmountStr('100');
      }
    } else if (unit.id === 'serving') {
      if (prevUnitId === 'g' && foodItem && foodItem.baseWeightGrams > 0) {
        const grams = parseNumber(amountStr);
        if (grams !== null && grams > 0) {
          const qty = Math.round((grams / foodItem.baseWeightGrams) * 10) / 10;
          setAmountStr(String(qty > 0 ? qty : 1));
        } else {
          setAmountStr('1');
        }
      } else if (amountStr === '100' || parseNumber(amountStr) === null) {
        setAmountStr('1');
      }
    } else {
      if (amountStr === '100' || parseNumber(amountStr) === null) {
        setAmountStr('1');
      }
    }
  };

  const stepAmount = (delta: number) => {
    const curr = parseNumber(amountStr) ?? 0;
    const next = Math.max(0, curr + delta);
    setAmountStr(String(Math.round(next * 10) / 10));
  };

  const onSave = async () => {
    if (saving) return;
    if (name.trim() === '') {
      Alert.alert('Missing Name', 'Please select or enter a food name.');
      return;
    }
    setSaving(true);
    try {
      let totals: { calories: number; protein: number; carbs: number; fat: number } | null = null;
      let snapshotPer100: Per100 | null = null;
      let loggedGrams: number | null = null;

      if (foodItem && !manualMode) {
        if (!nutrition || nutrition.netGrams <= 0) {
          Alert.alert('Missing Quantity', 'Enter the quantity or scale weight.');
          setSaving(false);
          return;
        }
        totals = {
          calories: nutrition.calories,
          protein: nutrition.protein,
          carbs: nutrition.carbs,
          fat: nutrition.fat,
        };
        loggedGrams = nutrition.netGrams;
        const r100 = 100 / foodItem.baseWeightGrams;
        snapshotPer100 = {
          calories: Math.round(foodItem.baseCalories * r100),
          protein: Math.round(foodItem.baseProtein * r100 * 10) / 10,
          carbs: Math.round(foodItem.baseCarbs * r100 * 10) / 10,
          fat: Math.round(foodItem.baseFat * r100 * 10) / 10,
        };
      } else {
        const kcal = parseNumber(kcalStr);
        if (kcal === null || kcal < 0) {
          Alert.alert('Missing Calories', 'Enter the calories for this entry.');
          setSaving(false);
          return;
        }
        const p = parseNumber(pStr) ?? 0;
        const c = parseNumber(cStr) ?? 0;
        const f = parseNumber(fStr) ?? 0;
        totals = { calories: kcal, protein: p, carbs: c, fat: f };
        loggedGrams = effectiveGrams !== null && effectiveGrams > 0 ? effectiveGrams : null;
        if (loggedGrams !== null && loggedGrams > 0) {
          snapshotPer100 = {
            calories: (kcal * 100) / loggedGrams,
            protein: (p * 100) / loggedGrams,
            carbs: (c * 100) / loggedGrams,
            fat: (f * 100) / loggedGrams,
          };
        } else {
          snapshotPer100 = null;
        }
      }

      if (entryId !== null) {
        await updateMealEntry(db, entryId, {
          date,
          mealType,
          grams: loggedGrams,
          per100: snapshotPer100,
          totals,
          foodName: name.trim(),
        });
      } else {
        await insertMealEntry(db, {
          date,
          mealType,
          foodName: name.trim(),
          grams: loggedGrams,
          calories: totals.calories,
          protein: totals.protein,
          carbs: totals.carbs,
          fat: totals.fat,
          foodId,
          per100: snapshotPer100,
        });
      }
      await recalculateAll(db);
      Keyboard.dismiss();
      router.back();
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (entryId === null || deleting) return;
    const doDelete = async () => {
      setDeleting(true);
      try {
        await deleteMealEntry(db, entryId);
        await recalculateAll(db);
        router.back();
      } finally {
        setDeleting(false);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Remove ${name} from ${mealType}?`)) {
        await doDelete();
      }
      return;
    }

    Alert.alert('Delete Food Entry', `Are you sure you want to remove "${name}" from ${mealType}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: doDelete,
      },
    ]);
  };

  const dateOptions = [todayISO(), addDays(todayISO(), -1), addDays(todayISO(), -2)];

  if (!ready) {
    return <Screen title={editing ? 'Edit Entry' : 'Log Food'} loading onBack={() => router.back()} />;
  }

  return (
    <Screen
      title={editing ? 'Edit Food Entry' : 'Food Logger'}
      subtitle={`${mealType} · ${formatDayLabel(date).split(' · ')[0]}`}
      onBack={() => router.back()}
    >
      {/* 1. EMBEDDED FAST FOOD SEARCH / PICKER */}
      {isPickerOpen ? (
        <Card highlight style={{ padding: 14, gap: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <CardTitle icon={<Ionicons name="search-outline" size={16} color={C.accent} />}>
              SELECT FOOD TO LOG
            </CardTitle>
            <Pressable
              onPress={() => router.push({ pathname: '/barcode-scanner' as any, params: { mealType } })}
              style={st.scanHeaderBtn}
            >
              <Ionicons name="barcode-outline" size={16} color={C.blue} />
              <Txt size="xs" weight="800" color={C.blue}>
                Scan
              </Txt>
            </Pressable>
          </View>

          {/* Search Box */}
          <View style={st.searchBar}>
            <Ionicons name="search-outline" size={16} color={C.dim} />
            <TextInput
              value={foodSearchQuery}
              onChangeText={setFoodSearchQuery}
              placeholder="Search 270+ foods, ulam, snacks, candies…"
              placeholderTextColor={C.dimmer}
              style={{ color: C.text, fontSize: 14, fontWeight: '600', paddingVertical: 10, paddingHorizontal: 4, flex: 1 }}
              autoCorrect={false}
              autoCapitalize="none"
              keyboardType="default"
              returnKeyType="search"
            />
            {foodSearchQuery ? (
              <Pressable onPress={() => setFoodSearchQuery('')} style={{ padding: 4 }}>
                <Ionicons name="close-circle" size={16} color={C.dim} />
              </Pressable>
            ) : null}
          </View>

          {/* Quick Staple Chips */}
          <View style={{ gap: 6 }}>
            <Txt size="xs" color={C.dimmer} weight="700">
              POPULAR STAPLES
            </Txt>
            <ChipRow>
              {POPULAR_FOODS.map((item) => (
                <Chip
                  key={item}
                  label={item}
                  active={false}
                  onPress={() => setFoodSearchQuery(item)}
                />
              ))}
            </ChipRow>
          </View>

          {/* Online Open Food Facts Trigger */}
          {foodSearchQuery.trim().length >= 2 ? (
            <Pressable
              onPress={() => triggerOnlineFoodSearch(foodSearchQuery)}
              disabled={isSearchingOnline}
              style={({ pressed }) => [st.onlineSearchTrigger, pressed && { opacity: 0.8 }]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <Ionicons name="sparkles" size={15} color={C.onAccent} />
                <Txt size="xs" weight="800" color={C.onAccent} numberOfLines={1}>
                  Smart Search &quot;{foodSearchQuery.trim()}&quot; (Open Food Facts)
                </Txt>
              </View>
              {isSearchingOnline ? (
                <ActivityIndicator size="small" color={C.onAccent} />
              ) : (
                <Ionicons name="chevron-forward" size={15} color={C.onAccent} />
              )}
            </Pressable>
          ) : null}

          {/* Online Results (if any) */}
          {openFoodResults.length > 0 ? (
            <View style={{ gap: 6 }}>
              <Txt size="xs" color={C.accent} weight="800">
                GLOBAL RESULTS ({openFoodResults.length})
              </Txt>
              {openFoodResults.slice(0, 5).map((p, idx) => (
                <Pressable
                  key={p.barcode || `${p.name}-${idx}`}
                  onPress={() => selectOnlineFood(p)}
                  style={({ pressed }) => [st.foodPickerItem, pressed && { opacity: 0.7 }]}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt size="sm" weight="700" numberOfLines={1}>
                      {p.name}
                    </Txt>
                    <Txt size="xs" color={C.dim}>
                      {p.brand ? `${p.brand} · ` : ''}
                      {`${fmtInt(p.proteinPer100g)}P · ${fmtInt(p.carbsPer100g)}C · ${fmtInt(p.fatPer100g)}F`}
                    </Txt>
                  </View>
                  <View style={st.kcalTag}>
                    <Txt size="xs" weight="800" color={C.kcal}>
                      {`${fmtInt(p.caloriesPer100g)} kcal`}
                    </Txt>
                  </View>
                </Pressable>
              ))}
              <Divider />
            </View>
          ) : null}

          {/* Local Food Results */}
          <View style={{ gap: 6 }}>
            <Txt size="xs" color={C.dimmer} weight="700">
              LOCAL FOOD DATABASE
            </Txt>
            {foodSearchResults.length === 0 ? (
              <Txt size="xs" color={C.dim} style={{ paddingVertical: 8 }}>
                No local foods match. Try Smart Search above or enter macros manually.
              </Txt>
            ) : (
              foodSearchResults.slice(0, 8).map((f) => (
                <Pressable
                  key={f.id}
                  onPress={() => selectLocalFood(f)}
                  style={({ pressed }) => [st.foodPickerItem, pressed && { opacity: 0.7 }]}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt size="sm" weight="700">
                      {f.food_name}
                    </Txt>
                    <Txt size="xs" color={C.dim}>
                      {`${fmtInt(f.protein_per_100g)}P · ${fmtInt(f.carbs_per_100g)}C · ${fmtInt(f.fat_per_100g)}F`}
                    </Txt>
                  </View>
                  <View style={st.kcalTag}>
                    <Txt size="xs" weight="800" color={C.kcal}>
                      {`${fmtInt(f.calories_per_100g)} kcal`}
                    </Txt>
                  </View>
                </Pressable>
              ))
            )}
          </View>

          {/* Manual Entry Fallback Button */}
          <Divider />
          <Pressable
            onPress={() => {
              setManualMode(true);
              setPer100(null);
              setIsPickerOpen(false);
            }}
            style={st.manualModeBtn}
          >
            <Ionicons name="create-outline" size={15} color={C.dim} />
            <Txt size="xs" weight="700" color={C.dim}>
              Or enter custom food name &amp; macros manually
            </Txt>
          </Pressable>
        </Card>
      ) : (
        /* SELECTED FOOD CARD */
        <Card highlight style={{ padding: 16 }}>
          {per100 && !manualMode ? (
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Txt size="lg" weight="900" color={C.text} style={{ letterSpacing: -0.4, flex: 1 }}>
                  {name}
                </Txt>
                <View style={st.refPill}>
                  <Txt size="xs" weight="700" color={C.dim}>
                    {foodItem && foodItem.servingUnitName
                      ? `${foodItem.baseCalories} kcal / ${foodItem.servingUnitName}`
                      : `${per100.calories} kcal / 100g`}
                  </Txt>
                </View>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Txt size="xs" color={C.dimmer} weight="600">
                  {foodItem && foodItem.servingUnitName
                    ? `Per ${foodItem.servingUnitName}: ${foodItem.baseProtein}g P · ${foodItem.baseCarbs}g C · ${foodItem.baseFat}g F`
                    : `Per 100g: ${per100.protein}g P · ${per100.carbs}g C · ${per100.fat}g F`}
                </Txt>
                <Pressable
                  onPress={() => setIsPickerOpen(true)}
                  style={st.changeFoodBtn}
                >
                  <Ionicons name="swap-horizontal" size={13} color={C.accent} />
                  <Txt size="xs" weight="800" color={C.accent}>
                    Change Food
                  </Txt>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Txt size="sm" weight="800" color={C.text}>
                  Custom Manual Food
                </Txt>
                <Pressable
                  onPress={() => setIsPickerOpen(true)}
                  style={st.changeFoodBtn}
                >
                  <Ionicons name="search" size={13} color={C.accent} />
                  <Txt size="xs" weight="800" color={C.accent}>
                    Search Food Database
                  </Txt>
                </Pressable>
              </View>
              <TextField
                label="Food Name"
                value={name}
                onChangeText={setName}
                placeholder="e.g. Chicken Breast, Rice, Eggs…"
                autoCapitalize="words"
              />
            </View>
          )}
        </Card>
      )}

      {/* 2. PORTION MEASUREMENT & UNIT SELECTOR */}
      <Card style={{ padding: 16, gap: 14 }}>
        <CardTitle icon={<Ionicons name="restaurant-outline" size={16} color={C.blue} />}>
          PORTION &amp; QUANTITY
        </CardTitle>

        {per100 && !manualMode ? (
          <View style={{ gap: 12 }}>
            {/* Unit Dropdown Selector */}
            <View style={{ gap: 4 }}>
              <Txt size="xs" weight="700" color={C.dim}>
                UNIT OF MEASUREMENT
              </Txt>

              <Pressable
                onPress={() => setShowUnitPickerModal(true)}
                style={({ pressed }) => [st.unitDropdownTrigger, pressed && { opacity: 0.8 }]}
              >
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="scale-outline" size={18} color={C.accent} />
                  <Txt size="md" weight="800" color={C.text}>
                    {activeUnit.label}
                  </Txt>
                </View>
                <View style={st.unitChangeBadge}>
                  <Txt size="xs" weight="800" color={C.accent}>
                    Change
                  </Txt>
                  <Ionicons name="chevron-down" size={14} color={C.accent} />
                </View>
              </Pressable>
            </View>

            {/* Custom Unit Grams Input (if custom selected) */}
            {selectedUnitId === 'custom' ? (
              <NumberField
                label="Grams per Custom Serving"
                value={customUnitGramsStr}
                onChangeText={setCustomUnitGramsStr}
                suffix="g"
                placeholder="50"
              />
            ) : null}

            {/* Quantity Input with +/- Stepper Buttons */}
            <View style={{ gap: 4 }}>
              <Txt size="xs" weight="700" color={C.dimmer} style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                QUANTITY ({activeUnit.short.toUpperCase()})
              </Txt>
              <View style={st.quantityRow}>
                <Pressable
                  onPress={() => stepAmount(selectedUnitId === 'g' ? -10 : -0.5)}
                  style={({ pressed }) => [st.stepBtn, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons name="remove" size={20} color={C.text} />
                </Pressable>

                <View style={st.quantityInputContainer}>
                  {Platform.OS === 'web' ? (
                    <input
                      type="text"
                      inputMode="decimal"
                      value={amountStr}
                      onChange={(e: any) => {
                        setAmountStr(e.target.value.replace(/[^0-9.]/g, ''));
                      }}
                      placeholder={selectedUnitId === 'g' ? '100' : '1'}
                      style={{
                        border: 'none',
                        outline: 'none',
                        background: 'transparent',
                        flex: 1,
                        minWidth: 0,
                        color: C.text,
                        fontSize: 22,
                        fontWeight: 800,
                        textAlign: 'center',
                        padding: '10px 0',
                        fontFamily: 'inherit',
                      } as any}
                    />
                  ) : (
                    <TextInput
                      value={amountStr}
                      onChangeText={(v) => {
                        setAmountStr(v.replace(/[^0-9.]/g, ''));
                      }}
                      keyboardType="numeric"
                      placeholder={selectedUnitId === 'g' ? '100' : '1'}
                      placeholderTextColor={C.dimmer}
                      style={{
                        flex: 1,
                        color: C.text,
                        fontSize: 22,
                        fontWeight: '800',
                        textAlign: 'center',
                        paddingVertical: 8,
                      }}
                      selectionColor={C.accent}
                    />
                  )}
                  <Txt size="sm" color={C.accent} weight="800" style={{ marginRight: 12 }}>
                    {activeUnit.short}
                  </Txt>
                </View>

                <Pressable
                  onPress={() => stepAmount(selectedUnitId === 'g' ? +10 : +0.5)}
                  style={({ pressed }) => [st.stepBtn, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons name="add" size={20} color={C.text} />
                </Pressable>
              </View>
            </View>

            {/* Quick Presets */}
            <ChipRow>
              {selectedUnitId === 'g'
                ? [25, 50, 75, 100, 150, 200, 250, 300].map((g) => {
                    const isCurrent = amountStr === String(g);
                    return (
                      <Chip
                        key={g}
                        label={`${g}g`}
                        active={isCurrent}
                        onPress={() => setAmountStr(String(g))}
                      />
                    );
                  })
                : [0.5, 1, 1.5, 2, 3, 4, 5].map((n) => {
                    const isCurrent = amountStr === String(n);
                    return (
                      <Chip
                        key={n}
                        label={`${n} ${activeUnit.short}${n > 1 ? 's' : ''}`}
                        active={isCurrent}
                        onPress={() => setAmountStr(String(n))}
                      />
                    );
                  })}
            </ChipRow>

            {/* Total Calculated Weight Summary */}
            <View style={st.calculatedWeightBanner}>
              <Ionicons name="scale-outline" size={15} color={C.accent} />
              <Txt size="sm" color={C.text} weight="700">
                {`Total Net Weight: ${effectiveGrams ?? 0}g · ${fmtInt(preview?.calories ?? 0)} kcal`}
              </Txt>
            </View>

            {/* LIVE MACRO PREVIEW */}
            {preview ? (
              <View style={st.macroGrid}>
                <View style={st.macroBox}>
                  <Txt size="xs" color={C.dim} weight="700">
                    CALORIES
                  </Txt>
                  <Txt size="lg" weight="900" color={C.kcal}>
                    {`${fmtInt(preview.calories)}`}
                  </Txt>
                  <Txt size="xs" color={C.dimmer}>
                    kcal
                  </Txt>
                </View>
                <View style={st.macroBox}>
                  <Txt size="xs" color={C.protein} weight="700">
                    PROTEIN
                  </Txt>
                  <Txt size="lg" weight="900" color={C.protein}>
                    {`${fmtNum(preview.protein)}`}
                  </Txt>
                  <Txt size="xs" color={C.dimmer}>
                    grams
                  </Txt>
                </View>
                <View style={st.macroBox}>
                  <Txt size="xs" color={C.carbs} weight="700">
                    CARBS
                  </Txt>
                  <Txt size="lg" weight="900" color={C.carbs}>
                    {`${fmtNum(preview.carbs)}`}
                  </Txt>
                  <Txt size="xs" color={C.dimmer}>
                    grams
                  </Txt>
                </View>
                <View style={st.macroBox}>
                  <Txt size="xs" color={C.fat} weight="700">
                    FAT
                  </Txt>
                  <Txt size="lg" weight="900" color={C.fat}>
                    {`${fmtNum(preview.fat)}`}
                  </Txt>
                  <Txt size="xs" color={C.dimmer}>
                    grams
                  </Txt>
                </View>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <NumberField
                label="Total Calories"
                value={kcalStr}
                onChangeText={setKcalStr}
                suffix="kcal"
                placeholder="300"
                style={{ flex: 1 }}
              />
              <NumberField
                label="Weight (Optional)"
                value={amountStr}
                onChangeText={setAmountStr}
                suffix="g"
                placeholder="100"
                style={{ flex: 1 }}
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <NumberField
                label="Protein"
                value={pStr}
                onChangeText={setPStr}
                suffix="g"
                placeholder="25"
                style={{ flex: 1 }}
              />
              <NumberField
                label="Carbs"
                value={cStr}
                onChangeText={setCStr}
                suffix="g"
                placeholder="30"
                style={{ flex: 1 }}
              />
              <NumberField
                label="Fat"
                value={fStr}
                onChangeText={setFStr}
                suffix="g"
                placeholder="8"
                style={{ flex: 1 }}
              />
            </View>
          </View>
        )}
      </Card>

      {/* 3. MEAL & DATE SELECTOR */}
      <Card style={{ padding: 16, gap: 12 }}>
        <CardTitle icon={<Ionicons name="time-outline" size={16} color={C.dim} />}>
          MEAL CATEGORY &amp; LOG DATE
        </CardTitle>

        {/* Meal Category Selector */}
        <ChipRow>
          {MEAL_TYPES.map((t) => (
            <Chip
              key={t}
              label={t}
              active={mealType === t}
              onPress={() => setMealType(t)}
            />
          ))}
        </ChipRow>

        <Divider />

        {/* Date Selector */}
        <ChipRow>
          {dateOptions.map((d) => (
            <Chip
              key={d}
              label={formatDayLabel(d).split(' · ')[0]}
              active={date === d}
              onPress={() => setDate(d)}
            />
          ))}
        </ChipRow>
      </Card>

      {/* 4. ACTIONS */}
      <View style={{ gap: 10, marginTop: 4 }}>
        <Button
          title={saving ? 'Saving…' : editing ? 'Update Food Entry' : `Log to ${mealType}`}
          onPress={onSave}
          disabled={saving || deleting}
        />

        {editing ? (
          <Button
            title={deleting ? 'Removing…' : 'Delete Food Entry'}
            variant="danger"
            onPress={onDelete}
            disabled={saving || deleting}
          />
        ) : null}
      </View>

      {/* 5. NATIVE MODAL FOR UNIT PICKER (MOBILE) */}
      <Modal
        visible={showUnitPickerModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowUnitPickerModal(false)}
      >
        <Pressable
          style={st.modalOverlay}
          onPress={() => setShowUnitPickerModal(false)}
        >
          <Pressable
            style={st.modalCard}
            onPress={(e) => e.stopPropagation?.()}
          >
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Txt size="md" weight="800" color={C.text}>
                  Select Unit of Measurement
                </Txt>
                <Pressable onPress={() => setShowUnitPickerModal(false)} style={{ padding: 4 }}>
                  <Ionicons name="close" size={20} color={C.dim} />
                </Pressable>
              </View>

              <View style={{ gap: 4 }}>
                {unitOptions.map((u) => {
                  const isSelected = u.id === selectedUnitId;
                  return (
                    <Pressable
                      key={u.id}
                      onPress={() => onSelectUnit(u)}
                      style={[st.unitModalItem, isSelected && st.unitModalItemActive]}
                    >
                      <Txt
                        size="sm"
                        weight={isSelected ? '800' : '600'}
                        color={isSelected ? C.accent : C.text}
                      >
                        {u.label}
                      </Txt>
                      {isSelected ? <Ionicons name="checkmark" size={16} color={C.accent} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const st = StyleSheet.create({
  scanHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.blueSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: C.border,
    gap: 6,
  },
  onlineSearchTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.accent,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  foodPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  kcalTag: {
    backgroundColor: C.blueSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  manualModeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  changeFoodBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  refPill: {
    backgroundColor: C.surfaceHi,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  unitDropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  unitChangeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quantityInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  stepBtn: {
    backgroundColor: C.surfaceHi,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  calculatedWeightBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
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
    maxWidth: 380,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  unitModalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  unitModalItemActive: {
    backgroundColor: C.surfaceHi,
  },
});
