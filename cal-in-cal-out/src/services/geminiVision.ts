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

  // Clean base64 string if it contains data URI prefix
  const cleanBase64 = base64Image.includes('base64,')
    ? base64Image.split('base64,')[1]
    : base64Image;

  const isWeb = Platform.OS === 'web';
  const url = isWeb
    ? '/api/gemini/vision'
    : `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${encodeURIComponent(
        apiKey,
      )}`;

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

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (isWeb && apiKey) {
    headers['x-gemini-key'] = apiKey;
  }

  // Automatic retry with exponential backoff on 503 / 429
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const maxAttempts = 3;
  let lastErrorText = '';
  let lastStatus = 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const candidateText =
          data.candidates?.[0]?.content?.parts?.[0]?.text ||
          data.text ||
          '';

        if (!candidateText) {
          throw new Error('No analysis generated from image.');
        }

        const parsed: VisionScanResult = JSON.parse(candidateText);

        // Sanitize and ensure valid numbers
        const items: VisionFoodItem[] = (parsed.items || []).map((item) => ({
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

      lastStatus = res.status;
      lastErrorText = await res.text();

      // If server returned 503 or 429, wait with exponential backoff and retry
      if ((res.status === 503 || res.status === 429) && attempt < maxAttempts) {
        const delay = attempt * 2000; // 2s, 4s
        await sleep(delay);
        continue;
      }

      throw new Error(`AI Analysis error (${res.status}): ${lastErrorText || 'Service error'}`);
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.name === 'AbortError') {
        if (attempt < maxAttempts) {
          await sleep(2000);
          continue;
        }
        throw new Error('AI analysis timed out. Check your internet connection.');
      }
      if (attempt >= maxAttempts) {
        throw err;
      }
      await sleep(attempt * 2000);
    }
  }

  throw new Error(`AI Analysis error (${lastStatus}): ${lastErrorText || 'Service unavailable'}`);
}

const GEMINI_TEXT_SYSTEM_INSTRUCTION =
  'You are an expert sports nutrition calculation assistant. Parse free-form food descriptions (e.g. "220 gram of white rice, 340 gram of pork steak", "2 eggs and toast with 10g butter") into individual ingredients with accurate portion estimates in grams and verified per-100g nutritional metrics (USDA/NCCDB). Output strictly valid JSON conforming to the schema.';

export async function parseMealTextWithAi(
  textDescription: string,
  customApiKey?: string,
): Promise<VisionScanResult> {
  const apiKey = resolveApiKey(customApiKey);
  const isWeb = Platform.OS === 'web';
  const url = isWeb
    ? '/api/gemini/vision'
    : `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${encodeURIComponent(
        apiKey,
      )}`;

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

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (isWeb && apiKey) {
    headers['x-gemini-key'] = apiKey;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`AI calculation error (${res.status}): ${errText || 'Service error'}`);
    }

    const data = await res.json();
    const candidateText =
      data.candidates?.[0]?.content?.parts?.[0]?.text || data.text || '';

    if (!candidateText) {
      throw new Error('No analysis generated from food description.');
    }

    const parsed: VisionScanResult = JSON.parse(candidateText);

    const items: VisionFoodItem[] = (parsed.items || []).map((item) => ({
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
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError') {
      throw new Error('AI analysis timed out. Check your internet connection.');
    }
    throw err;
  }
}

/** Minimal request to verify a Gemini API key works. Returns a success message or throws. */
export async function testGeminiKey(customApiKey?: string): Promise<string> {
  const apiKey = resolveApiKey(customApiKey);
  const isWeb = Platform.OS === 'web';
  const url = isWeb
    ? '/api/gemini/vision'
    : `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${encodeURIComponent(
        apiKey,
      )}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (isWeb && apiKey) {
    headers['x-gemini-key'] = apiKey;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Reply with the single word OK.' }] }],
    }),
  });

  if (!res.ok) {
    if (res.status === 400 || res.status === 403) {
      throw new Error('Key rejected by Google. Double-check the key and that the Gemini API is enabled.');
    }
    throw new Error(`Request failed (HTTP ${res.status}).`);
  }

  return 'Key works! The model responded successfully.';
}
