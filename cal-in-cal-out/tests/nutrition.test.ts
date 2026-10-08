import {
  calculateNutrition,
  extractServingInfo,
  foodToFoodItem,
  type FoodItem,
} from '../src/lib/nutrition';

function assertEq(actual: unknown, expected: unknown, msg?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg ?? 'assertEq'}: expected ${e}, got ${a}`);
  }
}

console.log('Running nutrition calculation & serving tests...');

// 1. Test calculateNutrition with packaged food (e.g. Nescafé Classic Stick 1.9g, 5 kcal)
{
  const nescafeStick: FoodItem = {
    name: 'Nescafé Classic Stick 1.9g',
    baseCalories: 5,
    baseProtein: 0.1,
    baseCarbs: 1.0,
    baseFat: 0,
    baseWeightGrams: 1.9,
    servingUnitName: 'Stick',
  };

  // 1 stick (serving)
  const oneStick = calculateNutrition(nescafeStick, 'SERVING', 1);
  assertEq(oneStick.netGrams, 1.9, '1 stick should be 1.9g');
  assertEq(oneStick.calories, 5, '1 stick should be 5 kcal');

  // 2 sticks (serving)
  const twoSticks = calculateNutrition(nescafeStick, 'SERVING', 2);
  assertEq(twoSticks.netGrams, 3.8, '2 sticks should be 3.8g');
  assertEq(twoSticks.calories, 10, '2 sticks should be 10 kcal');

  // Grams on scale: 1.9g
  const scaleStick = calculateNutrition(nescafeStick, 'GRAMS', 1.9);
  assertEq(scaleStick.netGrams, 1.9);
  assertEq(scaleStick.calories, 5);

  // Grams on scale: 100g
  const hundredGrams = calculateNutrition(nescafeStick, 'GRAMS', 100);
  assertEq(hundredGrams.netGrams, 100);
  // factor = 100 / 1.9 = 52.6315..., 5 * 52.6315 = 263.15 -> 263 kcal
  assertEq(hundredGrams.calories, 263, '100g should scale proportionally to 263 kcal');
  console.log('  ok - Nescafe Classic stick scales correctly in Servings and Grams');
}

// 2. Test calculateNutrition with bulk ingredient (e.g. Cooked Chicken Breast, 165 kcal / 100g)
{
  const chickenBreast: FoodItem = {
    name: 'Chicken Breast (Cooked)',
    baseCalories: 165,
    baseProtein: 31,
    baseCarbs: 0,
    baseFat: 3.6,
    baseWeightGrams: 100,
  };

  const scale100 = calculateNutrition(chickenBreast, 'GRAMS', 100);
  assertEq(scale100.netGrams, 100);
  assertEq(scale100.calories, 165);
  assertEq(scale100.protein, 31);

  const scale150 = calculateNutrition(chickenBreast, 'GRAMS', 150);
  assertEq(scale150.netGrams, 150);
  assertEq(scale150.calories, Math.round(165 * 1.5));
  assertEq(scale150.protein, Math.round(31 * 1.5 * 10) / 10);
  console.log('  ok - Bulk chicken breast scales correctly');
}

// 3. Test extractServingInfo
{
  const r1 = extractServingInfo('Nescafé Classic Stick 1.9g');
  assertEq(r1.servingWeightGrams, 1.9);
  assertEq(r1.servingUnitName, 'Stick');

  const r2 = extractServingInfo('Kopiko Blanca Creamy Coffee Mix (1 sachet 30g = ~140 kcal)');
  assertEq(r2.servingWeightGrams, 30);
  assertEq(r2.servingUnitName, 'Sachet');

  const r3 = extractServingInfo('Century Tuna in Oil (155g can)');
  assertEq(r3.servingWeightGrams, 155);
  assertEq(r3.servingUnitName, 'Can');

  const r4 = extractServingInfo('Whole Egg (50g)');
  assertEq(r4.servingWeightGrams, 50);
  assertEq(r4.servingUnitName, 'Egg');

  const r5 = extractServingInfo('Whey Protein Powder', '1 scoop (30g)');
  assertEq(r5.servingWeightGrams, 30);
  assertEq(r5.servingUnitName, 'Scoop');
  console.log('  ok - extractServingInfo parses packaged food units and weights');
}

// 4. Test foodToFoodItem
{
  // When food was saved with calories_per_100g = 5 for a 1.9g stick
  const item1 = foodToFoodItem({
    food_name: 'Nescafé Classic Stick 1.9g',
    calories_per_100g: 5,
    serving_weight_grams: 1.9,
    serving_unit_name: 'Stick',
  });
  assertEq(item1.baseWeightGrams, 1.9);
  assertEq(item1.servingUnitName, 'Stick');
  assertEq(item1.baseCalories, 5);

  // When bulk item has no serving weight
  const item2 = foodToFoodItem({
    food_name: 'Cooked White Rice',
    calories_per_100g: 130,
    protein_per_100g: 2.7,
    carbs_per_100g: 28,
    fat_per_100g: 0.3,
  });
  assertEq(item2.baseWeightGrams, 100);
  assertEq(item2.servingUnitName, undefined);
  assertEq(item2.baseCalories, 130);
  console.log('  ok - foodToFoodItem correctly initializes packaged and bulk food items');
}

console.log('All nutrition tests passed!');
