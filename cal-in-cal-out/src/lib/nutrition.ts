export interface FoodItem {
  name: string;
  baseCalories: number;
  baseProtein: number;
  baseCarbs: number;
  baseFat: number;
  baseWeightGrams: number; // e.g., 1.9g for coffee stick, or 100g for bulk
  servingUnitName?: string; // e.g., "Stick", "Can", "Scoop"
}

export interface CalculatedNutrition {
  netGrams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/**
 * Reactively calculate displayed macros:
 * Scales Calories, Protein, Carbs, and Fat proportionally based on
 * effective weight in grams divided by base weight in grams.
 */
export function calculateNutrition(
  food: FoodItem,
  selectedUnit: 'SERVING' | 'GRAMS',
  quantity: number,
): CalculatedNutrition {
  let effectiveGrams = 0;

  if (selectedUnit === 'SERVING') {
    effectiveGrams = quantity * food.baseWeightGrams;
  } else {
    // User selected raw grams on scale
    effectiveGrams = quantity;
  }

  const factor = effectiveGrams / food.baseWeightGrams;

  return {
    netGrams: Math.round(effectiveGrams * 10) / 10,
    calories: Math.round(food.baseCalories * factor),
    protein: Math.round(food.baseProtein * factor * 10) / 10,
    carbs: Math.round(food.baseCarbs * factor * 10) / 10,
    fat: Math.round(food.baseFat * factor * 10) / 10,
  };
}

const UNIT_KEYWORDS = [
  'stick',
  'sachet',
  'can',
  'scoop',
  'bar',
  'pack',
  'packet',
  'bottle',
  'piece',
  'pc',
  'egg',
  'slice',
  'cup',
  'tbsp',
  'box',
  'pouch',
] as const;

function formatUnitName(unit: string): string {
  const clean = unit.trim().toLowerCase();
  if (clean === 'pc' || clean === 'piece') return 'Piece';
  if (clean === 'tbsp') return 'Tablespoon';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * Extracts serving weight in grams and unit name from food name or serving size string.
 * Examples:
 * - "Nescafé Classic Stick 1.9g" -> { servingWeightGrams: 1.9, servingUnitName: "Stick" }
 * - "Kopiko Blanca Creamy Coffee Mix (1 sachet 30g = ~140 kcal)" -> { servingWeightGrams: 30, servingUnitName: "Sachet" }
 * - "Century Tuna in Oil (155g can)" -> { servingWeightGrams: 155, servingUnitName: "Can" }
 * - "Whole Egg (50g)" -> { servingWeightGrams: 50, servingUnitName: "Egg" }
 * - "1 stick (1.9 g)" -> { servingWeightGrams: 1.9, servingUnitName: "Stick" }
 */
export function extractServingInfo(
  foodName: string,
  servingSizeStr?: string | null,
): {
  servingWeightGrams?: number;
  servingUnitName?: string;
} {
  const combined = [servingSizeStr ?? '', foodName].filter(Boolean).join(' ');

  // 1. Try matching keyword + grams or grams + keyword
  const keywordPattern = UNIT_KEYWORDS.join('|');

  // e.g. "Stick 1.9g", "sachet 30g", "can 155g"
  const kwThenGramsRegex = new RegExp(
    `\\b(${keywordPattern})\\b[^0-9]{0,10}(\\d+(?:\\.\\d+)?)\\s*(?:g|grams?)\\b`,
    'i',
  );
  const kwMatch = combined.match(kwThenGramsRegex);
  if (kwMatch) {
    const unitName = formatUnitName(kwMatch[1]);
    const weight = Number(kwMatch[2]);
    if (Number.isFinite(weight) && weight > 0) {
      return { servingWeightGrams: weight, servingUnitName: unitName };
    }
  }

  // e.g. "1.9g stick", "30g sachet", "155g can", "50g egg"
  const gramsThenKwRegex = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*(?:g|grams?)\\b[^a-z0-9]{0,10}\\b(${keywordPattern})\\b`,
    'i',
  );
  const gkwMatch = combined.match(gramsThenKwRegex);
  if (gkwMatch) {
    const weight = Number(gkwMatch[1]);
    const unitName = formatUnitName(gkwMatch[2]);
    if (Number.isFinite(weight) && weight > 0) {
      return { servingWeightGrams: weight, servingUnitName: unitName };
    }
  }

  // 2. Check if a unit keyword exists alone with a separate gram measure
  // e.g. "1 Stick (1.9 g)"
  const standAloneKwRegex = new RegExp(`\\b(${keywordPattern})\\b`, 'i');
  const kwAloneMatch = combined.match(standAloneKwRegex);
  const gramsAloneRegex = /(?:[~(~]|\s|^)(\d+(?:\.\d+)?)\s*(?:g|grams?)\b/i;
  const gAloneMatch = combined.match(gramsAloneRegex);
  if (kwAloneMatch && gAloneMatch) {
    const weight = Number(gAloneMatch[1]);
    const unitName = formatUnitName(kwAloneMatch[1]);
    if (Number.isFinite(weight) && weight > 0) {
      return { servingWeightGrams: weight, servingUnitName: unitName };
    }
  }

  // 3. Fallback: isolated gram weight if present
  if (gAloneMatch) {
    const weight = Number(gAloneMatch[1]);
    if (Number.isFinite(weight) && weight > 0) {
      return { servingWeightGrams: weight, servingUnitName: 'Serving' };
    }
  }

  return {};
}

/**
 * Normalizes a Food entity from the database or API into a FoodItem.
 */
export function foodToFoodItem(
  food: {
    food_name: string;
    calories_per_100g: number;
    protein_per_100g?: number | null;
    carbs_per_100g?: number | null;
    fat_per_100g?: number | null;
    serving_weight_grams?: number | null;
    serving_unit_name?: string | null;
  },
  servingSizeHint?: string | null,
): FoodItem {
  let weight = food.serving_weight_grams ?? null;
  let unit = food.serving_unit_name ?? null;

  if (!weight || weight <= 0) {
    const extracted = extractServingInfo(food.food_name, servingSizeHint);
    if (extracted.servingWeightGrams && extracted.servingWeightGrams > 0) {
      weight = extracted.servingWeightGrams;
      unit = unit || extracted.servingUnitName || null;
    }
  }

  const p100 = food.protein_per_100g ?? 0;
  const c100 = food.carbs_per_100g ?? 0;
  const f100 = food.fat_per_100g ?? 0;

  // Single-serve / packaged item with native serving that is not 100g
  const hasNativeServing = weight !== null && weight > 0 && Math.abs(weight - 100) > 0.01;

  if (hasNativeServing) {
    const servingWeight = weight!;
    const servingUnit = unit || 'Serving';

    // Detect if food.calories_per_100g was stored as single-serving base calories
    // (e.g. "Nescafé Classic Stick 1.9g" stored with 5 kcal).
    // If food.calories_per_100g * (servingWeight / 100) < 0.8 while calories_per_100g >= 1,
    // scaling it down by /100 would result in ~0 kcal, so it is already base calories.
    const scaledCalories = (food.calories_per_100g * servingWeight) / 100;
    const isAlreadyPerServing =
      servingWeight < 25 && food.calories_per_100g <= 50 && scaledCalories < 1.0;

    const baseCalories = isAlreadyPerServing
      ? food.calories_per_100g
      : Math.round(scaledCalories);
    const ratio = isAlreadyPerServing ? 1 : servingWeight / 100;

    return {
      name: food.food_name,
      baseCalories,
      baseProtein: Math.round(p100 * ratio * 10) / 10,
      baseCarbs: Math.round(c100 * ratio * 10) / 10,
      baseFat: Math.round(f100 * ratio * 10) / 10,
      baseWeightGrams: servingWeight,
      servingUnitName: servingUnit,
    };
  }

  // Bulk food (default 100g reference)
  return {
    name: food.food_name,
    baseCalories: Math.round(food.calories_per_100g),
    baseProtein: Math.round(p100 * 10) / 10,
    baseCarbs: Math.round(c100 * 10) / 10,
    baseFat: Math.round(f100 * 10) / 10,
    baseWeightGrams: 100,
    servingUnitName: undefined,
  };
}
