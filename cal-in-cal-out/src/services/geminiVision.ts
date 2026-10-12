import { Platform } from 'react-native';

export interface VisionFoodItem {
  food_name: string;
  estimated_grams: number;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
}

export interface VisionScanResult {
  items: VisionFoodItem[];
  total_calories: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
}

export interface LabelScanResult {
  food_name: string;
  brand?: string;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  serving_weight_grams?: number;
  serving_unit_name?: string;
  category?: string;
}

const DEFAULT_GEMINI_API_KEY =
  process.env.EXPO_PUBLIC_GEMINI_API_KEY ||
  process.env.GEMINI_API_KEY ||
  '';

const NO_KEY_MESSAGE =
  'No Gemini API key configured. Add your free key in Settings → Advanced Settings → Gemini AI.';

function resolveApiKey(customApiKey?: string): string {
  const key = (customApiKey && customApiKey.trim()) || DEFAULT_GEMINI_API_KEY;
  if (!key && Platform.OS !== 'web') {
    throw new Error(NO_KEY_MESSAGE);
  }
  return key;
}

/** High-speed OCR and label-reading cascade */
const OCR_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
];

/** Multimodal visual plate segmentation models */
const VISION_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
];

/** Natural language text parser models */
const TEXT_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
];

async function callGeminiWithCascade({
  models,
  apiKey,
  requestBody,
  timeoutMs = 30000,
}: {
  models: string[];
  apiKey: string;
  requestBody: any;
  timeoutMs?: number;
}): Promise<any> {
  const isWeb = Platform.OS === 'web';

  // On Web, proxy through the local /api/gemini/vision endpoint
  if (isWeb) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['x-gemini-key'] = apiKey;
      const res = await fetch('/api/gemini/vision', {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const candidateText =
          data.candidates?.[0]?.content?.parts?.[0]?.text || data.text || '';
        if (candidateText) {
          return typeof candidateText === 'string' ? JSON.parse(candidateText) : candidateText;
        }
      }
    } catch {}
  }

  // On Native Android / iOS (or web fallback): cascade through Google's models
  let lastErrorText = '';
  let lastStatus = 500;

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
      apiKey,
    )}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        const candidateText =
          data.candidates?.[0]?.content?.parts?.[0]?.text || data.text || '';
        if (candidateText) {
          return typeof candidateText === 'string' ? JSON.parse(candidateText) : candidateText;
        }
      }

      lastStatus = res.status;
      lastErrorText = await res.text();
      // On 503, 429, or 404, silently cascade to the next model in the list
      continue;
    } catch (err: any) {
      clearTimeout(timer);
      lastErrorText = err?.message || 'Network request failed';
      continue;
    }
  }

  throw new Error(`AI service busy (${lastStatus}): ${lastErrorText || 'Please try again in a moment'}`);
}

const GEMINI_SYSTEM_INSTRUCTION =
  'You are a specialized sports nutrition vision assistant. Segment each food component visible on the plate. Prioritize any explicit hints provided by the user (cooking oils, specific cuts of meat, pre-weighed rice) over raw visual guesses. Output strictly valid JSON matching the provided schema, with portion estimates in grams and accurate nutritional reference metrics per 100g from verified databases (USDA/NCCDB).';

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          food_name: { type: 'STRING' },
          estimated_grams: { type: 'NUMBER' },
          calories_per_100g: { type: 'NUMBER' },
          protein_per_100g: { type: 'NUMBER' },
          carbs_per_100g: { type: 'NUMBER' },
          fat_per_100g: { type: 'NUMBER' },
        },
        required: [
          'food_name',
          'estimated_grams',
          'calories_per_100g',
          'protein_per_100g',
          'carbs_per_100g',
          'fat_per_100g',
        ],
      },
    },
    total_calories: { type: 'NUMBER' },
    total_protein: { type: 'NUMBER' },
    total_carbs: { type: 'NUMBER' },
    total_fat: { type: 'NUMBER' },
  },
  required: ['items', 'total_calories', 'total_protein', 'total_carbs', 'total_fat'],
};

export async function analyzeMealImage(
  base64Image: string,
  userHints?: string,
  mimeType = 'image/jpeg',
  customApiKey?: string,
): Promise<VisionScanResult> {
  const apiKey = resolveApiKey(customApiKey);

  const cleanBase64 = base64Image.includes('base64,')
    ? base64Image.split('base64,')[1]
    : base64Image;

  const promptText = userHints && userHints.trim()
    ? `User Notes & Preparation Hints: ${userHints.trim()}`
    : 'Analyze this meal plate and estimate all food items and portions.';

  const requestBody = {
    system_instruction: {
      parts: [{ text: GEMINI_SYSTEM_INSTRUCTION }],
    },
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data: cleanBase64,
            },
          },
          {
            text: promptText,
          },
        ],
      },
    ],
    generationConfig: {
      response_mime_type: 'application/json',
      response_schema: GEMINI_RESPONSE_SCHEMA,
      temperature: 0.2,
    },
  };

  const parsed = await callGeminiWithCascade({
    models: VISION_MODELS,
    apiKey,
    requestBody,
    timeoutMs: 35000,
  });

  const items: VisionFoodItem[] = (parsed.items || []).map((item: any) => ({
    food_name: item.food_name || 'Food item',
    estimated_grams: Math.max(1, Math.round(Number(item.estimated_grams || 100))),
    calories_per_100g: Math.max(0, Math.round(Number(item.calories_per_100g || 0))),
    protein_per_100g: Math.max(0, Math.round(Number(item.protein_per_100g || 0) * 10) / 10),
    carbs_per_100g: Math.max(0, Math.round(Number(item.carbs_per_100g || 0) * 10) / 10),
    fat_per_100g: Math.max(0, Math.round(Number(item.fat_per_100g || 0) * 10) / 10),
  }));

  let calcKcal = 0;
  let calcP = 0;
  let calcC = 0;
  let calcF = 0;

  for (const it of items) {
    const r = it.estimated_grams / 100;
    calcKcal += it.calories_per_100g * r;
    calcP += it.protein_per_100g * r;
    calcC += it.carbs_per_100g * r;
    calcF += it.fat_per_100g * r;
  }

  return {
    items,
    total_calories: Math.round(parsed.total_calories || calcKcal),
    total_protein: Math.round((parsed.total_protein || calcP) * 10) / 10,
    total_carbs: Math.round((parsed.total_carbs || calcC) * 10) / 10,
    total_fat: Math.round((parsed.total_fat || calcF) * 10) / 10,
  };
}

const GEMINI_TEXT_SYSTEM_INSTRUCTION =
  'You are an expert sports nutrition calculation assistant. Parse free-form food descriptions (e.g. "220 gram of white rice, 340 gram of pork steak", "2 eggs and toast with 10g butter") into individual ingredients with accurate portion estimates in grams and verified per-100g nutritional metrics (USDA/NCCDB). Output strictly valid JSON conforming to the schema.';

export async function parseMealTextWithAi(
  textDescription: string,
  customApiKey?: string,
): Promise<VisionScanResult> {
  const apiKey = resolveApiKey(customApiKey);

  const requestBody = {
    system_instruction: {
      parts: [{ text: GEMINI_TEXT_SYSTEM_INSTRUCTION }],
    },
    contents: [
      {
        parts: [
          {
            text: `Parse and calculate nutrition for these food items: "${textDescription.trim()}". Estimate portion weights in grams and verified macro values per 100g.`,
          },
        ],
      },
    ],
    generationConfig: {
      response_mime_type: 'application/json',
      response_schema: GEMINI_RESPONSE_SCHEMA,
      temperature: 0.1,
    },
  };

  const parsed = await callGeminiWithCascade({
    models: TEXT_MODELS,
    apiKey,
    requestBody,
    timeoutMs: 25000,
  });

  const items: VisionFoodItem[] = (parsed.items || []).map((item: any) => ({
    food_name: item.food_name || 'Food item',
    estimated_grams: Math.max(1, Math.round(Number(item.estimated_grams || 100))),
    calories_per_100g: Math.max(0, Math.round(Number(item.calories_per_100g || 0))),
    protein_per_100g: Math.max(0, Math.round(Number(item.protein_per_100g || 0) * 10) / 10),
    carbs_per_100g: Math.max(0, Math.round(Number(item.carbs_per_100g || 0) * 10) / 10),
    fat_per_100g: Math.max(0, Math.round(Number(item.fat_per_100g || 0) * 10) / 10),
  }));

  let calcKcal = 0;
  let calcP = 0;
  let calcC = 0;
  let calcF = 0;

  for (const it of items) {
    const r = it.estimated_grams / 100;
    calcKcal += it.calories_per_100g * r;
    calcP += it.protein_per_100g * r;
    calcC += it.carbs_per_100g * r;
    calcF += it.fat_per_100g * r;
  }

  return {
    items,
    total_calories: Math.round(parsed.total_calories || calcKcal),
    total_protein: Math.round((parsed.total_protein || calcP) * 10) / 10,
    total_carbs: Math.round((parsed.total_carbs || calcC) * 10) / 10,
    total_fat: Math.round((parsed.total_fat || calcF) * 10) / 10,
  };
}

const GEMINI_LABEL_SYSTEM_INSTRUCTION =
  'You are a high-speed sports nutrition OCR expert. Read the product packaging, brand name, and Nutrition Facts table in this photo. Extract the product name (including brand if visible), portion serving size in grams, and calculate or extract the nutritional reference values per 100g (calories, protein, carbs, fat). If values are provided per serving, normalize them accurately to per 100g using the serving weight in grams. Return strictly valid JSON conforming to the schema.';

const GEMINI_LABEL_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    food_name: { type: 'STRING' },
    brand: { type: 'STRING' },
    serving_weight_grams: { type: 'NUMBER' },
    serving_unit_name: { type: 'STRING' },
    calories_per_100g: { type: 'NUMBER' },
    protein_per_100g: { type: 'NUMBER' },
    carbs_per_100g: { type: 'NUMBER' },
    fat_per_100g: { type: 'NUMBER' },
    category: { type: 'STRING' },
  },
  required: [
    'food_name',
    'calories_per_100g',
    'protein_per_100g',
    'carbs_per_100g',
    'fat_per_100g',
  ],
};

/** High-speed OCR: reads Nutrition Facts labels & packaging using Gemini 1.5 Flash 8B / Flash */
export async function analyzeNutritionLabelImage(
  base64Image: string,
  barcodeHint?: string,
  mimeType = 'image/jpeg',
  customApiKey?: string,
): Promise<LabelScanResult> {
  const apiKey = resolveApiKey(customApiKey);

  const cleanBase64 = base64Image.includes('base64,')
    ? base64Image.split('base64,')[1]
    : base64Image;

  const promptText = barcodeHint
    ? `Analyze this product packaging for barcode ${barcodeHint}. Read the Nutrition Facts label and extract per-100g metrics and serving size in grams.`
    : 'Read the Nutrition Facts label on this packaging. Extract product name, portion size in grams, and calories/protein/carbs/fat per 100g.';

  const requestBody = {
    system_instruction: { parts: [{ text: GEMINI_LABEL_SYSTEM_INSTRUCTION }] },
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mimeType, data: cleanBase64 } },
          { text: promptText },
        ],
      },
    ],
    generationConfig: {
      response_mime_type: 'application/json',
      response_schema: GEMINI_LABEL_RESPONSE_SCHEMA,
      temperature: 0.1,
    },
  };

  const parsed = await callGeminiWithCascade({
    models: OCR_MODELS,
    apiKey,
    requestBody,
    timeoutMs: 25000,
  });

  const displayName = parsed.brand && !parsed.food_name?.includes(parsed.brand)
    ? `${parsed.brand} - ${parsed.food_name}`
    : parsed.food_name || 'Packaged Product';

  return {
    food_name: displayName,
    brand: parsed.brand || undefined,
    calories_per_100g: Math.max(0, Math.round(Number(parsed.calories_per_100g) || 0)),
    protein_per_100g: Math.max(0, Math.round((Number(parsed.protein_per_100g) || 0) * 10) / 10),
    carbs_per_100g: Math.max(0, Math.round((Number(parsed.carbs_per_100g) || 0) * 10) / 10),
    fat_per_100g: Math.max(0, Math.round((Number(parsed.fat_per_100g) || 0) * 10) / 10),
    serving_weight_grams: parsed.serving_weight_grams
      ? Math.max(1, Math.round(Number(parsed.serving_weight_grams)))
      : undefined,
    serving_unit_name: parsed.serving_unit_name || 'Serving',
    category: parsed.category || 'Packaged Foods',
  };
}

/** Minimal request to verify a Gemini API key works. */
export async function testGeminiKey(customApiKey?: string): Promise<string> {
  const apiKey = resolveApiKey(customApiKey);
  const requestBody = {
    contents: [{ parts: [{ text: 'Reply with the single word OK.' }] }],
  };

  await callGeminiWithCascade({
    models: ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'],
    apiKey,
    requestBody,
    timeoutMs: 15000,
  });

  return 'Key works! The model responded successfully.';
}
