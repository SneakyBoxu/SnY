import { useEffect, useState } from 'react';
import { Alert, Keyboard, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { Spacing } from '@/constants/theme';
import { parseNumber } from '@/lib/num';
import { useDb } from '@/db/db';
import { FOOD_CATEGORIES } from '@/db/seed-foods';
import { createFood, getFood, listCategories, updateFood } from '@/db/queries';
import {
  Button,
  Card,
  CardTitle,
  Chip,
  ChipRow,
  NumberField,
  Screen,
  TextField,
  Txt,
} from '@/components/ui';

export default function EditFoodScreen() {
  const db = useDb();
  const params = useLocalSearchParams<{
    foodId?: string;
    name?: string;
    kcal?: string;
    protein?: string;
    carbs?: string;
    fat?: string;
    category?: string;
    barcode?: string;
  }>();

  const editing = params.foodId !== undefined;
  const [foodId, setFoodId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [category, setCategory] = useState<string>('General');
  const [servingWeight, setServingWeight] = useState('');
  const [servingUnit, setServingUnit] = useState('');
  const [ready, setReady] = useState(false);
  const [extraCategories, setExtraCategories] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const cats = await listCategories(db);
        if (live) {
          setExtraCategories(cats.filter((c) => !(FOOD_CATEGORIES as readonly string[]).includes(c)));
        }

        if (params.foodId !== undefined) {
          const food = await getFood(db, Number(params.foodId));
          if (food && live) {
            setFoodId(food.id);
            setName(food.food_name);
            setKcal(String(food.calories_per_100g));
            setProtein(String(food.protein_per_100g));
            setCarbs(String(food.carbs_per_100g));
            setFat(String(food.fat_per_100g));
            setCategory(food.category);
            setServingWeight(food.serving_weight_grams ? String(food.serving_weight_grams) : '');
            setServingUnit(food.serving_unit_name ?? '');
          }
        } else if (params.name !== undefined) {
          if (live) {
            setName(params.name);
            setKcal(params.kcal ?? '');
            setProtein(params.protein ?? '');
            setCarbs(params.carbs ?? '');
            setFat(params.fat ?? '');
            setCategory(params.category ?? 'General');
          }
        }
      } catch (err) {
        console.warn('Error loading food to edit:', err);
      } finally {
        if (live) setReady(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [db, params]);

  const onSave = async () => {
    if (saving) return;
    if (name.trim() === '') {
      Alert.alert('Missing name', 'Enter a food name.');
      return;
    }
    const kcalN = parseNumber(kcal);
    if (kcalN === null || kcalN < 0) {
      Alert.alert('Invalid calories', 'Enter calories per 100g.');
      return;
    }
    const sWeight = parseNumber(servingWeight);
    const food = {
      food_name: name.trim(),
      calories_per_100g: kcalN,
      protein_per_100g: parseNumber(protein) ?? 0,
      carbs_per_100g: parseNumber(carbs) ?? 0,
      fat_per_100g: parseNumber(fat) ?? 0,
      category,
      barcode: params.barcode ?? undefined,
      serving_weight_grams: sWeight !== null && sWeight > 0 ? sWeight : null,
      serving_unit_name: servingUnit.trim() ? servingUnit.trim() : null,
    };
    setSaving(true);
    try {
      if (editing && foodId !== null) {
        await updateFood(db, foodId, food);
      } else {
        try {
          await createFood(db, food);
        } catch {
          Alert.alert('Duplicate name', 'A food with this name already exists.');
          setSaving(false);
          return;
        }
      }
      Keyboard.dismiss();
      router.back();
    } finally {
      setSaving(false);
    }
  };

  const allCategories = [...FOOD_CATEGORIES, ...extraCategories, 'General'];

  if (!ready) {
    return <Screen title={editing ? 'Edit Food' : 'Customize Food'} loading />;
  }

  return (
    <Screen
      title={editing ? 'Edit Food' : params.name ? 'Customize & Save' : 'New Food'}
      subtitle="Nutrition per 100g (scale weight standard)"
      onBack={() => router.back()}
      right={<Button title={saving ? 'Saving…' : 'Save'} small onPress={onSave} disabled={saving} />}
    >
      <Card>
        <CardTitle>Food Details</CardTitle>
        <TextField
          label="Food Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Kopiko Blanca (1 Sachet)"
          autoCapitalize="words"
        />
        <View style={{ flexDirection: 'row', gap: Spacing.s, marginTop: Spacing.s }}>
          <NumberField style={{ flex: 1 }} label="kcal / 100g" value={kcal} onChangeText={setKcal} placeholder="165" />
          <NumberField style={{ flex: 1 }} label="Protein (g)" value={protein} onChangeText={setProtein} placeholder="31" />
        </View>
        <View style={{ flexDirection: 'row', gap: Spacing.s, marginTop: Spacing.s }}>
          <NumberField style={{ flex: 1 }} label="Carbs (g)" value={carbs} onChangeText={setCarbs} placeholder="0" />
          <NumberField style={{ flex: 1 }} label="Fat (g)" value={fat} onChangeText={setFat} placeholder="3.6" />
        </View>
        <View style={{ flexDirection: 'row', gap: Spacing.s, marginTop: Spacing.s }}>
          <TextField
            label="Serving Unit"
            value={servingUnit}
            onChangeText={setServingUnit}
            placeholder="Stick, Can, Scoop"
            style={{ flex: 1 }}
          />
          <NumberField
            label="Serving Weight"
            value={servingWeight}
            onChangeText={setServingWeight}
            suffix="g"
            placeholder="1.9"
            style={{ flex: 1 }}
          />
        </View>
      </Card>

      <Card>
        <CardTitle>Category</CardTitle>
        <ChipRow>
          {allCategories.map((cat) => (
            <Chip
              key={cat}
              label={cat}
              active={category === cat}
              onPress={() => setCategory(cat)}
            />
          ))}
        </ChipRow>
        <Txt size="xs" style={{ color: '#8B99A8', marginTop: 4 }}>
          Tip: Enter nutrition per 100g so you can weigh exact grams on your scale anytime.
        </Txt>
      </Card>
    </Screen>
  );
}
