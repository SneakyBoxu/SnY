import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { BarcodeFormat, BrowserMultiFormatReader, DecodeHintType } from '@zxing/library';
import * as ImagePicker from 'expo-image-picker';
import { Camera, CameraView, useCameraPermissions, type BarcodeScanningResult, type BarcodeType } from 'expo-camera';

import { C } from '@/constants/theme';
import { fmtInt } from '@/lib/num';
import type { Food } from '@/lib/types';
import { useDb } from '@/db/db';
import { createFood, getFoodByBarcode } from '@/db/queries';
import { Button, Card, CardTitle, Divider, NumberField, Screen, Txt } from '@/components/ui';
import { lookupBarcodeOpenFoodFacts } from '@/services/openFoodFacts';

// Offline sample test barcodes for quick demo/testing
const POPULAR_BARCODES: { barcode: string; name: string; kcal: number; p: number; c: number; f: number; category: string }[] = [
  { barcode: '4800016644801', name: 'Century Tuna Flakes in Oil (Canned)', kcal: 180, p: 21, c: 0, f: 10.5, category: 'Seafood' },
  { barcode: '4800016053016', name: 'San Marino Corned Tuna', kcal: 165, p: 18, c: 2.5, f: 9.5, category: 'Seafood' },
  { barcode: '4800011122334', name: 'SkyFlakes Crackers (per pack 28g)', kcal: 430, p: 9, c: 68, f: 14, category: 'Snacks & Sweets' },
  { barcode: '4800888123456', name: 'Lucky Me! Pancit Canton Kalamansi', kcal: 460, p: 9, c: 62, f: 20, category: 'Grains & Starches' },
];

// Native camera barcode formats (mirrors the web zxing format list)
const EXPO_BARCODE_TYPES: BarcodeType[] = [
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'code128',
  'code39',
  'itf14',
  'codabar',
  'qr',
];

export default function BarcodeScannerScreen() {
  const db = useDb();
  const params = useLocalSearchParams<{ mealType?: string }>();
  const mealTypeParam = params.mealType;

  const [barcodeInput, setBarcodeInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [foundFood, setFoundFood] = useState<Food | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const isWeb = Platform.OS === 'web';

  // Camera / image decoding state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const readerRef = useRef<any>(null);
  const [scanning, setScanning] = useState(false);
  const [decodingImage, setDecodingImage] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const lockRef = useRef(false);

  // Native camera permissions
  const [nativePermission, requestNativePermission] = useCameraPermissions();

  const getScanner = () => {
    if (!readerRef.current) {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.ITF,
        BarcodeFormat.CODABAR,
        BarcodeFormat.QR_CODE,
      ]);
      readerRef.current = new BrowserMultiFormatReader(hints);
    }
    return readerRef.current;
  };

  const stopCamera = useCallback(() => {
    try {
      readerRef.current?.reset?.();
    } catch {}
    lockRef.current = false;
    setScanning(false);
    setTorchOn(false);
  }, []);

  // Stop camera on unmount
  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  const lookupBarcode = useCallback(
    async (code: string) => {
      const clean = code.trim();
      if (!clean) return;
      setSearching(true);
      setFeedback(null);

      // 1. Check local SQLite database by barcode
      let food = await getFoodByBarcode(db, clean);

      // 2. Check offline demo sample barcodes
      if (!food) {
        const sample = POPULAR_BARCODES.find((b) => b.barcode === clean);
        if (sample) {
          const newId = await createFood(db, {
            food_name: sample.name,
            calories_per_100g: sample.kcal,
            protein_per_100g: sample.p,
            carbs_per_100g: sample.c,
            fat_per_100g: sample.f,
            category: sample.category,
            barcode: sample.barcode,
          });
          food = {
            id: newId,
            food_name: sample.name,
            calories_per_100g: sample.kcal,
            protein_per_100g: sample.p,
            carbs_per_100g: sample.c,
            fat_per_100g: sample.f,
            category: sample.category,
            is_seed: 0,
            barcode: sample.barcode,
          };
        }
      }

      // 3. Online fallback to Open Food Facts API
      if (!food) {
        try {
          const onlineProduct = await lookupBarcodeOpenFoodFacts(clean);
          if (onlineProduct) {
            const displayName = onlineProduct.brand
              ? `${onlineProduct.brand} - ${onlineProduct.name}`
              : onlineProduct.name;

            const newId = await createFood(db, {
              food_name: displayName,
              calories_per_100g: onlineProduct.caloriesPer100g,
              protein_per_100g: onlineProduct.proteinPer100g,
              carbs_per_100g: onlineProduct.carbsPer100g,
              fat_per_100g: onlineProduct.fatPer100g,
              category: onlineProduct.category || 'Packaged Foods',
              barcode: clean,
            });

            food = {
              id: newId,
              food_name: displayName,
              calories_per_100g: onlineProduct.caloriesPer100g,
              protein_per_100g: onlineProduct.proteinPer100g,
              carbs_per_100g: onlineProduct.carbsPer100g,
              fat_per_100g: onlineProduct.fatPer100g,
              category: onlineProduct.category || 'Packaged Foods',
              is_seed: 0,
              barcode: clean,
            };
          }
        } catch {
          // Offline / network fallback silent
        }
      }

      setSearching(false);
      if (food) {
        setFoundFood(food);
        setFeedback({ tone: 'ok', text: `Barcode ${clean} matched!` });
      } else {
        setFeedback({
          tone: 'err',
          text: `No nutrition data found for barcode ${clean}. You can create it as a custom food.`,
        });
      }
    },
    [db],
  );

  /* ---------------- WEB CAMERA (zxing, unchanged) ---------------- */

  const startCameraWeb = async () => {
    try {
      setFeedback(null);
      const reader = getScanner();
      setScanning(true);
      await reader.decodeFromVideoDevice(null, videoRef.current, (result: any) => {
        if (result) {
          const text = String(result.getText());
          stopCamera();
          setBarcodeInput(text);
          lookupBarcode(text);
        }
      });
    } catch {
      setScanning(false);
      setFeedback({
        tone: 'err',
        text: 'Camera unavailable. Grant camera permission in your browser, or use image import / manual entry below.',
      });
    }
  };

  const toggleTorchWeb = async () => {
    const next = !torchOn;
    setTorchOn(next);
    try {
      const stream = readerRef.current?.stream as MediaStream | undefined;
      const track = stream?.getVideoTracks?.()[0];
      if (track) {
        await track.applyConstraints({ advanced: [{ torch: next }] } as any);
      }
    } catch {
      // Torch not supported on this device/browser
    }
  };

  const onPickImageWeb = async (e: any) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    // Reset input so picking the same file again re-triggers change
    e.target.value = '';
    setDecodingImage(true);
    setFeedback(null);
    try {
      const reader = getScanner();
      const url = URL.createObjectURL(file);
      try {
        const result = await reader.decodeFromImageUrl(url);
        const text = String(result.getText());
        setBarcodeInput(text);
        await lookupBarcode(text);
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      setFeedback({
        tone: 'err',
        text: 'Could not detect a barcode in that image. Try a clearer, well-lit, close-up photo of the barcode.',
      });
    } finally {
      setDecodingImage(false);
    }
  };

  /* ---------------- NATIVE CAMERA (expo-camera) ---------------- */

  const startCameraNative = async () => {
    setFeedback(null);
    let permission = nativePermission;
    if (!permission?.granted) {
      try {
        permission = await requestNativePermission();
      } catch {
        permission = null;
      }
    }
    if (!permission?.granted) {
      setFeedback({
        tone: 'err',
        text: 'Camera permission is needed for live scanning. Grant it when asked, or import a photo below.',
      });
      return;
    }
    setScanning(true);
  };

  const handleNativeBarcode = useCallback(
    (e: BarcodeScanningResult) => {
      const text = e?.data ? String(e.data) : '';
      if (!text || lockRef.current) return;
      lockRef.current = true;
      stopCamera();
      setBarcodeInput(text);
      lookupBarcode(text);
    },
    [lookupBarcode, stopCamera],
  );

  const importGalleryImageNative = async () => {
    try {
      setFeedback(null);
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setFeedback({
          tone: 'err',
          text: 'Photo access is needed to import a picture. Grant photo permission when asked.',
        });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      setDecodingImage(true);
      const decoded = await Camera.scanFromURLAsync(asset.uri, EXPO_BARCODE_TYPES);
      const text = decoded?.[0]?.data ? String(decoded[0].data) : '';
      if (text) {
        setBarcodeInput(text);
        await lookupBarcode(text);
      } else {
        setFeedback({
          tone: 'err',
          text: 'Could not detect a barcode in that image. Try a clearer, well-lit, close-up photo of the barcode.',
        });
      }
    } catch {
      setFeedback({
        tone: 'err',
        text: 'Could not read that image. Try a clearer close-up photo.',
      });
    } finally {
      setDecodingImage(false);
    }
  };

  const startCamera = isWeb ? startCameraWeb : startCameraNative;
  const toggleTorch = isWeb ? toggleTorchWeb : () => setTorchOn((v) => !v);
  const importGalleryImage = isWeb ? undefined : importGalleryImageNative;

  const selectAndWeigh = (food: Food) => {
    router.replace({
      pathname: '/add-entry',
      params: {
        foodId: String(food.id),
        ...(mealTypeParam ? { mealType: mealTypeParam } : {}),
      },
    });
  };

  return (
    <Screen
      title="Barcode Scanner"
      subtitle="Live camera, photo import, or manual EAN/UPC entry"
      onBack={() => router.back()}
    >
      {/* Hidden file input for image import (web) */}
      {isWeb ? (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onPickImageWeb}
        />
      ) : null}

      {/* 1. CAMERA VIEWFINDER */}
      <Card highlight style={{ padding: 20, alignItems: 'center' }}>
        <View style={st.viewfinderFrame}>
          {isWeb && scanning ? (
            <video
              ref={videoRef}
              muted
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover' } as any}
            />
          ) : !isWeb && scanning ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              enableTorch={torchOn}
              barcodeScannerSettings={{ barcodeTypes: EXPO_BARCODE_TYPES }}
              onBarcodeScanned={handleNativeBarcode}
            />
          ) : (
            <View style={{ alignItems: 'center', gap: 6 }}>
              <Ionicons
                name={scanning ? 'scan-outline' : 'barcode-outline'}
                size={48}
                color={C.blue}
              />
              <Txt size="xs" weight="800" color={C.dim} align="center">
                {scanning ? 'SCANNING...' : 'START CAMERA OR IMPORT A PHOTO'}
              </Txt>
            </View>
          )}

          {/* Corner brackets */}
          <View style={[st.corner, st.tl]} />
          <View style={[st.corner, st.tr]} />
          <View style={[st.corner, st.bl]} />
          <View style={[st.corner, st.br]} />
        </View>

        {/* Controls */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12, justifyContent: 'center' }}>
          <Pressable
            onPress={() => (scanning ? stopCamera() : startCamera())}
            style={[
              st.actionPill,
              scanning && { backgroundColor: C.accent, borderColor: C.accent },
            ]}
          >
            <Ionicons
              name={scanning ? 'stop-circle-outline' : 'camera-outline'}
              size={16}
              color={scanning ? C.bg : C.text}
            />
            <Txt size="xs" weight="800" color={scanning ? C.bg : C.text}>
              {scanning ? 'Stop Camera' : 'Start Camera Scan'}
            </Txt>
          </Pressable>

          <Pressable
            onPress={() => (isWeb ? fileInputRef.current?.click() : importGalleryImage?.())}
            disabled={decodingImage}
            style={[st.actionPill, decodingImage && { opacity: 0.6 }]}
          >
            <Ionicons name="image-outline" size={16} color={C.blue} />
            <Txt size="xs" weight="800" color={C.blue}>
              {decodingImage ? 'Reading Photo...' : 'Import Barcode Photo'}
            </Txt>
          </Pressable>

          {scanning ? (
            <Pressable
              onPress={toggleTorch}
              style={[st.actionPill, torchOn && { backgroundColor: C.warn, borderColor: C.warn }]}
            >
              <Ionicons
                name={torchOn ? 'flash' : 'flash-outline'}
                size={16}
                color={torchOn ? C.bg : C.text}
              />
              <Txt size="xs" weight="800" color={torchOn ? C.bg : C.text}>
                {torchOn ? 'Torch On' : 'Torch Off'}
              </Txt>
            </Pressable>
          ) : null}
        </View>
      </Card>

      {/* 2. FEEDBACK BANNER */}
      {feedback ? (
        <Card style={{ borderColor: feedback.tone === 'ok' ? C.accent : C.warn }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons
              name={feedback.tone === 'ok' ? 'checkmark-circle' : 'warning'}
              size={16}
              color={feedback.tone === 'ok' ? C.accent : C.warn}
            />
            <Txt size="sm" weight="600" color={feedback.tone === 'ok' ? C.accent : C.warn} style={{ flex: 1 }}>
              {feedback.text}
            </Txt>
          </View>
        </Card>
      ) : null}

      {/* 3. MATCHED SCANNED PRODUCT PREVIEW */}
      {foundFood ? (
        <Card highlight style={{ borderColor: C.accent }}>
          <CardTitle icon={<Ionicons name="checkmark-circle" size={16} color={C.accent} />}>
            PRODUCT IDENTIFIED
          </CardTitle>
          <View style={{ gap: 4 }}>
            <Txt size="lg" weight="900" color={C.text}>
              {foundFood.food_name}
            </Txt>
            <Txt size="xs" color={C.dimmer} weight="600">
              {`Barcode: ${foundFood.barcode ?? 'EAN-13'}`}
            </Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <View style={st.calBadge}>
                <Txt size="sm" weight="800" color={C.kcal}>
                  {`${fmtInt(foundFood.calories_per_100g)} kcal / 100g`}
                </Txt>
              </View>
              <Txt size="xs" color={C.dim} weight="600">
                {`${fmtInt(foundFood.protein_per_100g)}P  ${fmtInt(foundFood.carbs_per_100g)}C  ${fmtInt(foundFood.fat_per_100g)}F`}
              </Txt>
            </View>
          </View>
          <Button
            title="Log & Weigh on Scale"
            onPress={() => selectAndWeigh(foundFood)}
          />
        </Card>
      ) : null}

      {/* 4. MANUAL BARCODE DIGIT ENTRY */}
      <Card>
        <CardTitle icon={<Ionicons name="keypad-outline" size={15} color={C.accent} />}>
          LOOKUP BY BARCODE NUMBER
        </CardTitle>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <NumberField
            label=""
            value={barcodeInput}
            onChangeText={setBarcodeInput}
            placeholder="e.g. 4800016644801"
            style={{ flex: 1, margin: 0 }}
          />
          <Button
            title={searching ? 'Searching…' : 'Lookup'}
            small
            onPress={() => {
              Keyboard.dismiss();
              lookupBarcode(barcodeInput);
            }}
            disabled={searching || !barcodeInput.trim()}
          />
        </View>

        <Divider />

        <Txt size="xs" color={C.dimmer} weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Quick Test Barcodes (Philippine Products)
        </Txt>

        <View style={{ gap: 6 }}>
          {POPULAR_BARCODES.map((item) => (
            <Pressable
              key={item.barcode}
              onPress={() => {
                setBarcodeInput(item.barcode);
                lookupBarcode(item.barcode);
              }}
              style={({ pressed }) => [st.sampleRow, pressed && { opacity: 0.7 }]}
            >
              <View style={{ flex: 1, gap: 1 }}>
                <Txt size="sm" weight="700" color={C.text}>
                  {item.name}
                </Txt>
                <Txt size="xs" color={C.dimmer} weight="600">
                  {`EAN: ${item.barcode}`}
                </Txt>
              </View>
              <Ionicons name="arrow-forward-circle" size={18} color={C.blue} />
            </Pressable>
          ))}
        </View>
      </Card>
    </Screen>
  );
}

const st = StyleSheet.create({
  viewfinderFrame: {
    width: '100%',
    height: 220,
    backgroundColor: '#000',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.borderLight,
    position: 'relative',
    overflow: 'hidden',
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: C.accent,
    zIndex: 10,
  },
  tl: { top: 12, left: 12, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 6 },
  tr: { top: 12, right: 12, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 6 },
  bl: { bottom: 12, left: 12, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 6 },
  br: { bottom: 12, right: 12, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 6 },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.surfaceHi,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: C.border,
  },
  calBadge: {
    backgroundColor: C.blueSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sampleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surfaceAlt,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
});
