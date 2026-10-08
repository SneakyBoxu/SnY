import React, { useCallback, useEffect, useState } from 'react';
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
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { C } from '@/constants/theme';
import { useDb } from '@/db/db';
import {
  createFood,
  listMealEntries,
  searchFoods,
} from '@/db/queries';
import { todayISO } from '@/lib/date';
import { fmtInt, fmtNum } from '@/lib/num';
import { MEAL_TYPES, type Food, type MealType } from '@/lib/types';
import { Screen, Txt } from '@/components/ui';
import { OpenFoodFactsProduct, searchOpenFoodFacts } from '@/services/openFoodFacts';

interface HistoryFoodItem {
  id: number;
  food_name: string;
  serving_desc: string;
  calories: number;
  food_id?: number | null;
}

export default function LogFoodScreen() {
  const db = useDb();
  const params = useLocalSearchParams<{ mealType?: string; date?: string }>();

  const [date, setDate] = useState<string>(params.date || todayISO());
  const [mealType, setMealType] = useState<MealType>(
    (params.mealType as MealType) || 'Breakfast',
  );
  const [showMealDropdown, setShowMealDropdown] = useState(false);

  // Tabs: All | My Meals | My Recipes | My Foods
  const [activeTab, setActiveTab] = useState<'All' | 'My Meals' | 'My Recipes' | 'My Foods'>('All');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [localResults, setLocalResults] = useState<Food[]>([]);
  const [onlineResults, setOpenFoodResults] = useState<OpenFoodFactsProduct[]>([]);
  const [isSearchingOnline, setIsSearchingOnline] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryFoodItem[]>([]);

  // Load recent history items
  const loadHistory = useCallback(async () => {
    try {
      // Gather unique recent foods logged
      const recents = await db.getAllAsync<{
        food_name: string;
        serving_grams: number | null;
        calories: number;
        food_id: number | null;
        date: string;
      }>(
        `SELECT food_name, serving_grams, calories, food_id, date
         FROM meal_entries
         ORDER BY date DESC, id DESC
         LIMIT 60`,
      );

      const seen = new Set<string>();
      const list: HistoryFoodItem[] = [];

      for (let i = 0; i < recents.length; i++) {
        const item = recents[i];
        const key = item.food_name.toLowerCase().trim();
        if (!seen.has(key)) {
          seen.add(key);
          list.push({
            id: i,
            food_name: item.food_name,
            serving_desc: item.serving_grams ? `${Math.round(item.serving_grams)}g` : '1 serving',
            calories: Math.round(item.calories),
            food_id: item.food_id,
          });
        }
        if (list.length >= 20) break;
      }

      setHistoryItems(list);
    } catch {
      setHistoryItems([]);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory]),
  );

  // Search logic: Local search only as you type (no auto-triggering online API)
  useEffect(() => {
    let active = true;
    const clean = searchQuery.trim();

    if (!clean) {
      setLocalResults([]);
      setOpenFoodResults([]);
      setIsSearchingOnline(false);
      return;
    }

    const runLocal = async () => {
      const results = await searchFoods(db, clean, null, 25);
      if (active) {
        setLocalResults(results);
      }
    };

    const timer = setTimeout(runLocal, 100);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [db, searchQuery]);

  const triggerOnlineSearch = async () => {
    const q = searchQuery.trim();
    if (!q || q.length < 2) return;
    setIsSearchingOnline(true);
    try {
      const results = await searchOpenFoodFacts(q, 15);
      setOpenFoodResults(results);
    } catch {
      setOpenFoodResults([]);
    } finally {
      setIsSearchingOnline(false);
    }
  };

  // Quick log or customize portion
  const onSelectLocalFood = (food: Food) => {
    router.push({
      pathname: '/add-entry',
      params: {
        foodId: String(food.id),
        mealType,
        date,
      },
    });
  };

  const onSelectOnlineProduct = async (product: OpenFoodFactsProduct) => {
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

      router.push({
        pathname: '/add-entry',
        params: {
          foodId: String(newId),
          mealType,
          date,
        },
      });
    } catch {
      // If already exists or error, pass to add-entry
      const existing = await searchFoods(db, displayName, null, 1);
      if (existing.length > 0) {
        router.push({
          pathname: '/add-entry',
          params: { foodId: String(existing[0].id), mealType, date },
        });
      }
    }
  };

  const onSelectHistoryItem = (item: HistoryFoodItem) => {
    if (item.food_id) {
      router.push({
        pathname: '/add-entry',
        params: { foodId: String(item.food_id), mealType, date },
      });
    } else {
      router.push({
        pathname: '/add-entry',
        params: { mealType, date },
      });
    }
  };

  const isSearching = searchQuery.trim().length > 0;

  return (
    <Screen
      customHeader={
        <View style={st.headerBar}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [st.backBtn, pressed && { opacity: 0.6 }]}
            hitSlop={10}
          >
            <Ionicons name="arrow-back" size={22} color={C.text} />
          </Pressable>

          {/* Center: Meal Title Dropdown (e.g. Breakfast ▾) */}
          <Pressable
            onPress={() => setShowMealDropdown(true)}
            style={({ pressed }) => [st.mealTitleBtn, pressed && { opacity: 0.7 }]}
            hitSlop={8}
          >
            <Txt size="xl" weight="800" color={C.text}>
              {mealType === 'Snack' ? 'Snacks' : mealType}
            </Txt>
            <Ionicons name="caret-down" size={14} color={C.dim} style={{ marginTop: 3 }} />
          </Pressable>

          <View style={{ width: 32 }} />
        </View>
      }
    >
      {/* 1. SEARCH INPUT BAR */}
      <View style={st.searchContainer}>
        <View style={st.searchBar}>
          <Ionicons name="search" size={18} color={C.dim} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search for a food"
            placeholderTextColor={C.dimmer}
            style={st.searchInput}
            autoCorrect={false}
          />
          {searchQuery ? (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={C.dim} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* 2. TABS BAR: All | My Meals | My Recipes | My Foods */}
      <View style={st.tabsContainer}>
        {(['All', 'My Meals', 'My Recipes', 'My Foods'] as const).map((tab) => {
          const active = activeTab === tab;
          return (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={[st.tabItem, active && st.tabItemActive]}
            >
              <Txt
                size="sm"
                weight={active ? '800' : '600'}
                color={active ? '#FFFFFF' : C.dim}
              >
                {tab}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      {/* 3. QUICK SHORTCUT CARDS (Meal Scan & Scan a Barcode) */}
      {!isSearching ? (
        <View style={st.shortcutsRow}>
          {/* Meal Scan Card */}
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/meal-scan' as any,
                params: { mealType, date },
              })
            }
            style={({ pressed }) => [st.shortcutCard, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="camera-outline" size={30} color={C.accent} />
            <Txt size="sm" weight="700" color={C.text}>
              Meal Scan
            </Txt>
          </Pressable>

          {/* Scan a Barcode Card */}
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/barcode-scanner' as any,
                params: { mealType, date },
              })
            }
            style={({ pressed }) => [st.shortcutCard, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="barcode-outline" size={30} color={C.blue} />
            <Txt size="sm" weight="700" color={C.text}>
              Scan a Barcode
            </Txt>
          </Pressable>
        </View>
      ) : null}

      {/* 4. CONTENT LIST: SEARCH RESULTS OR HISTORY */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40, gap: 12 }}
      >
        {isSearching ? (
          /* SEARCH RESULTS (Local database + Smart Open Food Facts) */
          <View style={{ gap: 10 }}>
            {/* Local matches */}
            {localResults.length > 0 ? (
              <View style={st.resultsSection}>
                <Txt size="xs" weight="800" color={C.dimmer} style={st.sectionTitle}>
                  LOCAL DATABASE
                </Txt>
                {localResults.map((food) => (
                  <Pressable
                    key={food.id}
                    onPress={() => onSelectLocalFood(food)}
                    style={({ pressed }) => [st.foodItemRow, pressed && { opacity: 0.7 }]}
                  >
                    <View style={{ flex: 1, gap: 3, paddingRight: 10 }}>
                      <Txt size="sm" weight="800" color={C.text}>
                        {food.food_name}
                      </Txt>
                      <Txt size="xs" color={C.dim}>
                        {`${Math.round(food.calories_per_100g)} cal per 100g • ${Math.round(food.protein_per_100g)}P ${Math.round(food.carbs_per_100g)}C ${Math.round(food.fat_per_100g)}F`}
                      </Txt>
                    </View>
                    <View style={st.addCircleBtn}>
                      <Ionicons name="add" size={20} color="#3B82F6" />
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {/* Clickable Smart Search Button (Open Food Facts on-demand) */}
            <Pressable
              onPress={triggerOnlineSearch}
              disabled={isSearchingOnline}
              style={({ pressed }) => [
                st.smartSearchBannerBtn,
                pressed && { opacity: 0.8 },
                isSearchingOnline && { opacity: 0.6 },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {isSearchingOnline ? (
                  <ActivityIndicator size="small" color={C.accent} />
                ) : (
                  <View style={st.globeIconBox}>
                    <Ionicons name="globe-outline" size={18} color={C.accent} />
                  </View>
                )}
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt size="sm" weight="800" color={C.accent}>
                    {isSearchingOnline
                      ? 'Searching Open Food Facts...'
                      : `Search "${searchQuery.trim()}" globally`}
                  </Txt>
                  <Txt size="xs" color={C.dimmer}>
                    Tap to check Open Food Facts global database
                  </Txt>
                </View>
                <Ionicons name="arrow-forward" size={16} color={C.accent} />
              </View>
            </Pressable>

            {onlineResults.length > 0 ? (
              <View style={st.resultsSection}>
                <Txt size="xs" weight="800" color={C.accent} style={st.sectionTitle}>
                  GLOBAL RESULTS (OPEN FOOD FACTS)
                </Txt>
                {onlineResults.map((product) => {
                  const title = product.brand ? `${product.brand} - ${product.name}` : product.name;
                  return (
                    <Pressable
                      key={product.barcode || title}
                      onPress={() => onSelectOnlineProduct(product)}
                      style={({ pressed }) => [st.foodItemRow, pressed && { opacity: 0.7 }]}
                    >
                      <View style={{ flex: 1, gap: 3, paddingRight: 10 }}>
                        <Txt size="sm" weight="800" color={C.text}>
                          {title}
                        </Txt>
                        <Txt size="xs" color={C.dim}>
                          {`${Math.round(product.caloriesPer100g)} cal • ${product.servingSize || 'per 100g'}`}
                        </Txt>
                      </View>
                      <View style={st.addCircleBtn}>
                        <Ionicons name="add" size={18} color={C.accent} />
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {localResults.length === 0 && onlineResults.length === 0 && !isSearchingOnline ? (
              <View style={st.emptySearchState}>
                <Ionicons name="search-outline" size={32} color={C.dimmer} />
                <Txt size="sm" color={C.dimmer} align="center">
                  No local foods matched &quot;{searchQuery.trim()}&quot;.
                </Txt>
                <Txt size="xs" color={C.dim} align="center">
                  Tap the button above to search Open Food Facts, or create custom food below.
                </Txt>
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/add-entry',
                      params: { mealType, date },
                    })
                  }
                  style={st.createCustomBtn}
                >
                  <Txt size="xs" weight="800" color={C.accent}>
                    + Create Custom Food
                  </Txt>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : (
          /* HISTORY SECTION (Matching screenshot) */
          <View style={st.resultsSection}>
            <View style={st.historyHeaderRow}>
              <Txt size="md" weight="800" color={C.text}>
                History
              </Txt>
              <View style={st.sortChip}>
                <Ionicons name="filter-outline" size={13} color={C.dim} />
                <Txt size="xs" weight="700" color={C.dim}>
                  Most Recent
                </Txt>
              </View>
            </View>

            {historyItems.length > 0 ? (
              historyItems.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => onSelectHistoryItem(item)}
                  style={({ pressed }) => [st.foodItemRow, pressed && { opacity: 0.7 }]}
                >
                  <View style={{ flex: 1, gap: 3, paddingRight: 10 }}>
                    <Txt size="sm" weight="800" color={C.text}>
                      {item.food_name}
                    </Txt>
                    <Txt size="xs" color={C.dim}>
                      {`${item.calories} cal, ${item.serving_desc}`}
                    </Txt>
                  </View>
                  <View style={st.addCircleBtn}>
                    <Ionicons name="add" size={18} color={C.accent} />
                  </View>
                </Pressable>
              ))
            ) : (
              <View style={st.emptySearchState}>
                <Txt size="xs" color={C.dimmer}>
                  No recent history. Search above to log your first food!
                </Txt>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Meal Switcher Modal */}
      <Modal
        visible={showMealDropdown}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMealDropdown(false)}
      >
        <Pressable
          style={st.modalBackdrop}
          onPress={() => setShowMealDropdown(false)}
        >
          <View style={st.modalMenu}>
            {MEAL_TYPES.map((t) => (
              <Pressable
                key={t}
                onPress={() => {
                  setMealType(t);
                  setShowMealDropdown(false);
                }}
                style={[st.menuItem, mealType === t && st.menuItemActive]}
              >
                <Txt
                  size="sm"
                  weight={mealType === t ? '800' : '600'}
                  color={mealType === t ? C.accent : C.text}
                >
                  {t === 'Snack' ? 'Snacks' : t}
                </Txt>
                {mealType === t ? (
                  <Ionicons name="checkmark" size={16} color={C.accent} />
                ) : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const st = StyleSheet.create({
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  backBtn: {
    padding: 4,
  },
  mealTitleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  searchContainer: {
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceHi,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    color: C.text,
    fontSize: 14,
    padding: 0,
  },
  tabsContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  tabItem: {
    paddingVertical: 10,
    marginRight: 20,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: C.accent,
  },
  shortcutsRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  shortcutCard: {
    flex: 1,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  resultsSection: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: C.border,
    gap: 10,
  },
  sectionTitle: {
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  historyHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.surfaceHi,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  foodItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border + '60',
  },
  addCircleBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.surfaceHi,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smartSearchBannerBtn: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.accent + '60',
    borderRadius: 12,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  globeIconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySearchState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 10,
  },
  createCustomBtn: {
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: C.surfaceHi,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    paddingTop: 80,
  },
  modalMenu: {
    width: 220,
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  menuItemActive: {
    backgroundColor: C.surfaceHi,
  },
});
