import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { C } from '@/constants/theme';
import { addDays, formatDayLabel, todayISO } from '@/lib/date';
import { parseNumber } from '@/lib/num';
import { MEAL_TYPES, type MealType } from '@/lib/types';
import { useDb } from '@/db/db';
import { recalculateAll } from '@/db/recalc';
import { createFood, getSettings, guessMealType, insertMealEntry } from '@/db/queries';
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
import { analyzeMealImage, VisionFoodItem } from '@/services/geminiVision';

export default function MealScanScreen() {
  const db = useDb();
  const params = useLocalSearchParams<{ mealType?: string; date?: string }>();

  const [date, setDate] = useState<string>(params.date ?? todayISO());
  const [mealType, setMealType] = useState<MealType>(
    (params.mealType as MealType) ?? guessMealType(),
  );

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [userHints, setUserHints] = useState('');

  // AI scanning state
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [editableItems, setEditableItems] = useState<VisionFoodItem[]>([]);
  const [savingLogs, setSavingLogs] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Edit individual item modal state
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editGramsStr, setEditGramsStr] = useState('');
  const [editKcalStr, setEditKcalStr] = useState('');
  const [editProteinStr, setEditProteinStr] = useState('');
  const [editCarbsStr, setEditCarbsStr] = useState('');
  const [editFatStr, setEditFatStr] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isWeb = Platform.OS === 'web';

  const onSelectImage = (e: any) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setEditableItems([]);

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      // Downscale high-resolution mobile photos so the payload sends quickly and doesn't timeout
      const img = new (window as any).Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1024;
        const MAX_HEIGHT = 1024;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width = Math.round((width * MAX_HEIGHT) / height);
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        const optimizedBase64 = canvas.toDataURL('image/jpeg', 0.82);
        setImageBase64(optimizedBase64);
        setImageUri(optimizedBase64);
      };
      img.onerror = () => {
        setImageBase64(dataUrl);
        setImageUri(dataUrl);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  /* ---------------- NATIVE PHOTO CAPTURE / GALLERY (expo-image-picker) ---------------- */

  const applyNativeImage = async (asset: ImagePicker.ImagePickerAsset) => {
    let base64: string | null = asset.base64 ?? null;
    let uri = asset.uri;

    // Downscale high-resolution mobile photos so the payload sends quickly (mirrors the web canvas path)
    try {
      const context = ImageManipulator.manipulate(asset.uri);
      if (asset.width && asset.height) {
        if (asset.width > asset.height) {
          context.resize({ width: 1024, height: null });
        } else {
          context.resize({ height: 1024, width: null });
        }
      } else {
        context.resize({ width: 1024, height: null });
      }
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: 0.82,
        base64: true,
      });
      base64 = saved.base64 ?? base64;
      uri = saved.uri || uri;
    } catch {
      // Keep the picker asset as-is if manipulation fails
    }

    if (!base64) {
      setErrorMsg('Could not read the photo data. Please try another picture.');
      return;
    }

    setImageBase64(`data:image/jpeg;base64,${base64}`);
    setImageUri(uri);
  };

  const pickPhotoNative = async (source: 'camera' | 'library') => {
    try {
      setErrorMsg(null);
      setEditableItems([]);

      const perm =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setErrorMsg(
          source === 'camera'
            ? 'Camera permission is needed to photograph your plate. Grant it when asked.'
            : 'Photo access is needed to choose a picture. Grant photo permission when asked.',
        );
        return;
      }

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ quality: 0.9 })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              quality: 0.9,
            });

      if (result.canceled || !result.assets?.length) return;
      await applyNativeImage(result.assets[0]);
    } catch {
      setErrorMsg('Could not open the camera or gallery. Please try again.');
    }
  };

  const handlePhotoPress = () => {
    if (isWeb) {
      fileInputRef.current?.click();
    } else {
      pickPhotoNative('camera');
    }
  };

  const handleRunAiAnalysis = async () => {
    if (!imageBase64) {
      setErrorMsg('Please upload or capture a photo of your meal first.');
      return;
    }

    setAnalyzing(true);
    setAnalysisProgress(15);
    setErrorMsg(null);

    // Simulated step progression for visual feedback while vision model computes
    const interval = setInterval(() => {
      setAnalysisProgress((prev) => {
        if (prev < 40) return prev + 12;
        if (prev < 75) return prev + 6;
        if (prev < 92) return prev + 2;
        return prev;
      });
    }, 700);

    try {
      const settings = await getSettings(db);
      const result = await analyzeMealImage(imageBase64, userHints, 'image/jpeg', settings.gemini_api_key);
      setAnalysisProgress(100);
      setEditableItems(result.items);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to analyze plate. Please try again.');
    } finally {
      clearInterval(interval);
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

  // Computed totals from editable items
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

  const handleLogAllItems = async () => {
    if (editableItems.length === 0 || savingLogs) return;
    setSavingLogs(true);
    try {
      for (const item of editableItems) {
        if (item.estimated_grams <= 0) continue;

        let foodId: number | null = null;
        try {
          foodId = await createFood(db, {
            food_name: item.food_name.trim(),
            calories_per_100g: item.calories_per_100g,
            protein_per_100g: item.protein_per_100g,
            carbs_per_100g: item.carbs_per_100g,
            fat_per_100g: item.fat_per_100g,
            category: 'AI Scanned Foods',
          });
        } catch {
          // Food name already exists in database
        }

        const r = item.estimated_grams / 100;
        await insertMealEntry(db, {
          date,
          mealType,
          foodName: item.food_name.trim(),
          grams: item.estimated_grams,
          calories: item.calories_per_100g * r,
          protein: item.protein_per_100g * r,
          carbs: item.carbs_per_100g * r,
          fat: item.fat_per_100g * r,
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
      router.replace('/(tabs)');
    } finally {
      setSavingLogs(false);
    }
  };

  const dateOptions = [todayISO(), addDays(todayISO(), -1), addDays(todayISO(), -2)];

  return (
    <Screen
      title="AI Meal Vision Scan"
      subtitle={`${mealType} · Multimodal Plate Segmentation`}
      onBack={() => router.back()}
    >
      {/* Hidden file input for web */}
      {isWeb ? (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onSelectImage}
        />
      ) : null}

      {/* 1. PHOTO CAPTURE / UPLOAD CARD */}
      <Card highlight style={{ padding: 16, alignItems: 'center', gap: 12 }}>
        {imageUri ? (
          <View style={st.imageContainer}>
            <Image source={{ uri: imageUri }} style={st.foodImage} resizeMode="cover" />
            <Pressable
              onPress={handlePhotoPress}
              style={st.changePhotoOverlay}
            >
              <Ionicons name="camera" size={16} color="#fff" />
              <Txt size="xs" weight="800" color="#fff">
                Change Photo
              </Txt>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={handlePhotoPress}
            style={({ pressed }) => [st.uploadPlaceholder, pressed && { opacity: 0.8 }]}
          >
            <View style={st.uploadIconCircle}>
              <Ionicons name="camera-outline" size={32} color={C.accent} />
            </View>
            <Txt size="md" weight="800" color={C.text}>
              Take or Upload Meal Photo
            </Txt>
            <Txt size="xs" color={C.dim} align="center">
              Tap to capture your plate or choose a picture from your library
            </Txt>
          </Pressable>
        )}

        {/* Native camera / gallery picker actions */}
        {!isWeb ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', width: '100%' }}>
            <Pressable onPress={() => pickPhotoNative('camera')} style={st.pickActionPill}>
              <Ionicons name="camera-outline" size={16} color={C.text} />
              <Txt size="xs" weight="800" color={C.text}>
                Take Photo
              </Txt>
            </Pressable>
            <Pressable onPress={() => pickPhotoNative('library')} style={st.pickActionPill}>
              <Ionicons name="images-outline" size={16} color={C.blue} />
              <Txt size="xs" weight="800" color={C.blue}>
                Choose from Gallery
              </Txt>
            </Pressable>
          </View>
        ) : null}

        {/* User Preparation Hints Box */}
        <View style={{ width: '100%', gap: 6, marginTop: 4 }}>
          <Txt size="xs" weight="700" color={C.dimmer} style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
            Preparation Hints / Context (Optional)
          </Txt>
          <View style={st.hintsInputContainer}>
            <TextInput
              value={userHints}
              onChangeText={setUserHints}
              placeholder="e.g. Cooked in 1 tbsp oil, ~250g rice, pork kasim cut, 1 egg"
              placeholderTextColor={C.dimmer}
              style={{
                color: C.text,
                fontSize: 14,
                fontWeight: '600',
                padding: 10,
                outlineStyle: 'none',
              } as any}
            />
          </View>
        </View>

        {/* Scan Button */}
        <Button
          title={analyzing ? 'Analyzing Plate with Gemini AI…' : 'Scan'}
          onPress={handleRunAiAnalysis}
          disabled={analyzing || !imageUri}
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
        <Card style={{ padding: 20, alignItems: 'center', gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start' }}>
            <ActivityIndicator size="small" color={C.accent} />
            <Txt size="sm" weight="800" color={C.text}>
              Segmenting Plate & Estimating Macros…
            </Txt>
          </View>

          {/* Progress Bar */}
          <View style={st.progressBarTrack}>
            <View style={[st.progressBarFill, { width: `${analysisProgress}%` }]} />
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
            <Txt size="xs" color={C.dim}>
              {analysisProgress < 40
                ? 'Uploading & optimizing plate image…'
                : analysisProgress < 75
                  ? 'Identifying ingredients & recipe hints…'
                  : analysisProgress < 95
                    ? 'Estimating weights & USDA macro ratios…'
                    : 'Finalizing nutrition breakdown…'}
            </Txt>
            <Txt size="xs" weight="800" color={C.accent}>
              {`${analysisProgress}%`}
            </Txt>
          </View>
        </Card>
      ) : null}

      {/* 4. IDENTIFIED PLATE BREAKDOWN */}
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

                    {/* Editable Grams Box */}
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
                            width: 50,
                            padding: 2,
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

            {/* Total Plate Macro Summary (KCAL matching color theme) */}
            <Divider />
            <View style={st.macroGrid}>
              <View style={st.macroBox}>
                <Txt size="xs" color={C.kcal} weight="800">KCAL</Txt>
                <Txt size="lg" weight="900" color={C.kcal}>{totals.calories}</Txt>
              </View>
              <View style={st.macroBox}>
                <Txt size="xs" color={C.protein} weight="800">PROTEIN</Txt>
                <Txt size="lg" weight="900" color={C.protein}>{totals.protein}g</Txt>
              </View>
              <View style={st.macroBox}>
                <Txt size="xs" color={C.carbs} weight="800">CARBS</Txt>
                <Txt size="lg" weight="900" color={C.carbs}>{totals.carbs}g</Txt>
              </View>
              <View style={st.macroBox}>
                <Txt size="xs" color={C.fat} weight="800">FAT</Txt>
                <Txt size="lg" weight="900" color={C.fat}>{totals.fat}g</Txt>
              </View>
            </View>
          </Card>

          {/* 5. MEAL & DATE SELECTOR */}
          <Card style={{ padding: 16, gap: 12 }}>
            <CardTitle icon={<Ionicons name="time-outline" size={16} color={C.dim} />}>
              LOG TO MEAL &amp; DATE
            </CardTitle>

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

          {/* Log Action Button */}
          <Button
            title={savingLogs ? 'Saving Plate to Diary…' : `Log Plate to ${mealType}`}
            onPress={handleLogAllItems}
            disabled={savingLogs}
          />
        </>
      ) : null}

      {/* 6. EDIT ITEM DETAIL MODAL */}
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
                  Fine-Tune Nutrition Values
                </Txt>
                <Pressable onPress={() => setEditingIdx(null)} style={{ padding: 4 }}>
                  <Ionicons name="close" size={20} color={C.dim} />
                </Pressable>
              </View>

              <TextField
                label="Food Name"
                value={editName}
                onChangeText={setEditName}
                placeholder="e.g. Pork Adobo, White Rice…"
                autoCapitalize="words"
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
  uploadPlaceholder: {
    width: '100%',
    height: 180,
    backgroundColor: C.surfaceAlt,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: C.borderLight,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 8,
  },
  uploadIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: C.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickActionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.surfaceHi,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  imageContainer: {
    width: '100%',
    height: 220,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: C.border,
  },
  foodImage: {
    width: '100%',
    height: '100%',
  },
  changePhotoOverlay: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hintsInputContainer: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  componentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
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
  progressBarTrack: {
    width: '100%',
    height: 8,
    backgroundColor: C.surfaceHi,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: C.accent,
    borderRadius: 4,
  },
});
