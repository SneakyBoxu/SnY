import { Platform } from 'react-native';

import { extractServingInfo } from '@/lib/nutrition';

export interface OpenFoodFactsProduct {
  barcode: string;
  name: string;
  brand?: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  category: string;
  servingSize?: string;
  servingWeightGrams?: number;
  servingUnitName?: string;
  imageUrl?: string;
}

export const OPEN_FOOD_FACTS_USER_AGENT =
  'CalInCalOut/1.0.0 (https://github.com/calincalout; contact@calincalout.app)';

function parseProduct(p: any): OpenFoodFactsProduct | null {
  if (!p) return null;
  const name =
    (p.product_name && String(p.product_name).trim()) ||
    (p.product_name_en && String(p.product_name_en).trim()) ||
    (p.generic_name && String(p.generic_name).trim()) ||
    '';
  if (!name) return null;

  const nut = p.nutriments || {};
  let kcal = 0;
  if (nut['energy-kcal_100g'] !== undefined && nut['energy-kcal_100g'] !== '') {
    kcal = Math.round(Number(nut['energy-kcal_100g']));
  } else if (nut['energy-kcal'] !== undefined && nut['energy-kcal'] !== '') {
    kcal = Math.round(Number(nut['energy-kcal']));
  } else if (nut['energy_100g'] !== undefined && nut['energy_100g'] !== '') {
    // Energy in kJ converted to kcal (1 kcal = 4.184 kJ)
    kcal = Math.round(Number(nut['energy_100g']) / 4.184);
  }

  const pVal = Number(nut.proteins_100g ?? nut.proteins ?? 0);
  const cVal = Number(nut.carbohydrates_100g ?? nut.carbohydrates ?? 0);
  const fVal = Number(nut.fat_100g ?? nut.fat ?? 0);

  const protein = Number.isFinite(pVal) ? Math.round(pVal * 10) / 10 : 0;
  const carbs = Number.isFinite(cVal) ? Math.round(cVal * 10) / 10 : 0;
  const fat = Number.isFinite(fVal) ? Math.round(fVal * 10) / 10 : 0;

  // Derive simple readable category from categories tag or general
  let category = 'Packaged & Grocery';
  if (p.categories) {
    const primaryCat = String(p.categories).split(',')[0]?.trim();
    if (primaryCat && primaryCat.length < 30) {
      category = primaryCat;
    }
  }

  const servingSize = p.serving_size ? String(p.serving_size).trim() : undefined;
  const servingInfo = extractServingInfo(name, servingSize);

  return {
    barcode: p.code ? String(p.code) : '',
    name,
    brand: p.brands ? String(p.brands).trim() : undefined,
    caloriesPer100g: Math.max(0, kcal),
    proteinPer100g: Math.max(0, protein),
    carbsPer100g: Math.max(0, carbs),
    fatPer100g: Math.max(0, fat),
    category,
    servingSize,
    servingWeightGrams: servingInfo.servingWeightGrams,
    servingUnitName: servingInfo.servingUnitName,
    imageUrl: p.image_front_small_url || p.image_url,
  };
}

async function fetchOpenFoodProducts(
  searchTerm: string,
  pageSize: number,
  isWeb: boolean,
): Promise<OpenFoodFactsProduct[]> {
  const clean = searchTerm.trim();
  if (!clean || clean.length < 2) return [];

  const url = isWeb
    ? `/api/off/search?q=${encodeURIComponent(clean)}&pageSize=${pageSize}`
    : `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(
        clean,
      )}&search_simple=1&action=process&json=1&page_size=${pageSize}&fields=code,product_name,product_name_en,generic_name,brands,nutriments,categories,image_front_small_url,serving_size`;

  const headers: Record<string, string> = {};
  if (!isWeb) {
    headers['User-Agent'] = OPEN_FOOD_FACTS_USER_AGENT;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  const res = await fetch(url, {
    method: 'GET',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    signal: controller.signal,
  });
  clearTimeout(timeoutId);

  if (!res.ok) return [];
  const json = await res.json();
  if (!json || !Array.isArray(json.products)) return [];

  const results: OpenFoodFactsProduct[] = [];
  for (const p of json.products) {
    const parsed = parseProduct(p);
    if (
      parsed &&
      (parsed.caloriesPer100g > 0 ||
        parsed.proteinPer100g > 0 ||
        parsed.carbsPer100g > 0 ||
        parsed.fatPer100g > 0)
    ) {
      results.push(parsed);
    }
  }
  return results;
}

export async function searchOpenFoodFacts(
  query: string,
  pageSize = 15,
): Promise<OpenFoodFactsProduct[]> {
  const clean = query.trim();
  if (!clean || clean.length < 2) return [];

  const isWeb = Platform.OS === 'web';

  try {
    const firstResults = await fetchOpenFoodProducts(clean, pageSize, isWeb);
    if (firstResults.length > 0) return firstResults;

    // Fallback: If query has multiple terms (e.g. "petcho inasal"), try each term or synonym
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      for (const w of words) {
        if (w.length >= 3) {
          const fallback = await fetchOpenFoodProducts(w, pageSize, isWeb);
          if (fallback.length > 0) return fallback;
        }
      }
    }
    return [];
  } catch (err) {
    console.warn('Open Food Facts search error:', err);
    return [];
  }
}

export async function lookupBarcodeOpenFoodFacts(
  barcode: string,
): Promise<OpenFoodFactsProduct | null> {
  const clean = barcode.trim();
  if (!clean) return null;

  const isWeb = Platform.OS === 'web';
  const url = isWeb
    ? `/api/off/product?barcode=${encodeURIComponent(clean)}`
    : `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(clean)}.json`;

  const headers: Record<string, string> = {};
  if (!isWeb) {
    headers['User-Agent'] = OPEN_FOOD_FACTS_USER_AGENT;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      method: 'GET',
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const json = await res.json();
    if (json.status === 1 && json.product) {
      return parseProduct(json.product);
    }
    return null;
  } catch (err) {
    console.warn('Open Food Facts barcode lookup error:', err);
    return null;
  }
}
