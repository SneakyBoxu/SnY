import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { C } from '@/constants/theme';
import { fmtInt } from '@/lib/num';
import type { Food } from '@/lib/types';
import { useDb } from '@/db/db';
import { createFood, countFoods, deleteFood, listCategories, searchFoods } from '@/db/queries';
import {
  Button,
  Card,
  Chip,
  ChipRow,
  Divider,
  NumberField,
  Screen,
  Txt,
} from '@/components/ui';
import { OpenFoodFactsProduct, searchOpenFoodFacts } from '@/services/openFoodFacts';

export default function FoodsScreen() {
  const db = useDb();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [foods, setFoods] = useState<Food[] | null>(null);
  const [foodCount, setFoodCount] = useState(0);

  // Open Food Facts online search states
  const [openFoodResults, setOpenFoodResults] = useState<OpenFoodFactsProduct[]>([]);
  const [isSearchingOnline, setIsSearchingOnline] = useState(false);
  const [searchedOnlineQuery, setSearchedOnlineQuery] = useState('');

  // Selected item modal state (works across Web and Mobile)
  const [modalOpenProduct, setModalOpenProduct] = useState<OpenFoodFactsProduct | null>(null);
  const [modalLocalFood, setModalLocalFood] = useState<Food | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [savingAction, setSavingAction] = useState(false);

  const runSearch = useCallback(async () => {
    const list = await searchFoods(db, query, category);
    setFoods(list);
    countFoods(db).then(setFoodCount);
  }, [db, query, category]);

  useEffect(() => {
    const t = setTimeout(() => {
      runSearch();
    }, 120);
    return () => clearTimeout(t);
  }, [runSearch]);

  useFocusEffect(
    useCallback(() => {
      listCategories(db).then(setCategories);
      runSearch();
    }, [db, runSearch]),
  );

  // Trigger Open Food Facts search
  const triggerOnlineSearch = useCallback(
    async (searchQuery: string) => {
      const q = searchQuery.trim();
      if (!q || q.length < 2) return;
      setIsSearchingOnline(true);
      setSearchedOnlineQuery(q);
      try {
        const results = await searchOpenFoodFacts(q);
        setOpenFoodResults(results);
      } catch (e) {
        console.warn('Failed to search Open Food Facts:', e);
        setOpenFoodResults([]);
      } finally {
        setIsSearchingOnline(false);
      }
    },
    [],
  );

  const onSaveOpenFoodToCustom = async (product: OpenFoodFactsProduct, andLog = false) => {
    setSavingAction(true);
    try {
      const displayName = product.brand ? `${product.brand} - ${product.name}` : product.name;

      let targetId: number | null = null;
      try {
        targetId = await createFood(db, {
          food_name: displayName,
          calories_per_100g: product.caloriesPer100g,
          protein_per_100g: product.proteinPer100g,
          carbs_per_100g: product.carbsPer100g,
          fat_per_100g: product.fatPer100g,
          category: product.category || 'Packaged & Grocery',
          barcode: product.barcode || undefined,
        });
      } catch {
        // If already in custom_foods, look up its ID
        const existing = await searchFoods(db, displayName, null, 1);
        if (existing.length > 0) {
          targetId = existing[0].id;
        }
      }

      await runSearch();

      if (andLog) {
        setModalOpenProduct(null);
        if (targetId) {
          router.push({ pathname: '/add-entry', params: { foodId: String(targetId) } });
        } else {
          router.push({
            pathname: '/add-entry',
            params: {
              mealType: 'Breakfast',
            },
          });
        }
      } else {
        setFeedbackMsg(`✅ Saved "${displayName}" to your Food Database!`);
        setTimeout(() => setFeedbackMsg(null), 3000);
        setModalOpenProduct(null);
      }
    } finally {
      setSavingAction(false);
    }
  };

  const handleDeleteLocalFood = async (food: Food) => {
    await deleteFood(db, food.id);
    setModalLocalFood(null);
    await runSearch();
  };

  const cleanQuery = query.trim();

  return (
    <Screen
      title="Foods"
      subtitle={`${fmtInt(foodCount)} foods ready to log · local + global search`}
      right={
        <Chip
          label="+ Custom Food"
          active
          onPress={() => router.push('/edit-food')}
        />
      }
    >
      {/* Toast Feedback Notification */}
      {feedbackMsg ? (
        <View style={st.toastBanner}>
          <Txt size="sm" weight="700" color="#051510">
            {feedbackMsg}
          </Txt>
        </View>
      ) : null}

      {/* 1. SEARCH BAR */}
      <View style={st.searchContainer}>
        <Ionicons name="search-outline" size={18} color={C.dim} style={{ marginLeft: 4 }} />
        <NumberField
          label=""
          value={query}
          onChangeText={setQuery}
          placeholder="Search 270+ foods, ulam, or global products…"
          style={{ margin: 0, flex: 1 }}
        />
        {query ? (
          <Pressable
            onPress={() => {
              setQuery('');
              setOpenFoodResults([]);
              setSearchedOnlineQuery('');
            }}
            style={{ padding: 4 }}
          >
            <Ionicons name="close-circle" size={18} color={C.dim} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => router.push('/barcode-scanner' as any)}
          style={st.scanBtn}
        >
          <Ionicons name="barcode-outline" size={18} color={C.blue} />
          <Txt size="xs" weight="800" color={C.blue}>
            Scan
          </Txt>
        </Pressable>
      </View>

      {/* 2. CATEGORIES CHIP ROW */}
      <ChipRow>
        <Chip label="All Categories" active={category === null} onPress={() => setCategory(null)} />
        {categories.map((cat) => (
          <Chip
            key={cat}
            label={cat}
            active={category === cat}
            onPress={() => setCategory(category === cat ? null : cat)}
          />
        ))}
      </ChipRow>

      {/* 3. SEARCH OPEN FOOD FACTS TRIGGER BANNER */}
      {cleanQuery.length >= 2 ? (
        <Card style={st.onlineBanner}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="sparkles" size={16} color={C.accent} />
                <Txt size="sm" weight="800" color={C.accent}>
                  Smart Online Search
                </Txt>
              </View>
              <Txt size="xs" color={C.dim} numberOfLines={1}>
                {searchedOnlineQuery === cleanQuery
                  ? `${openFoodResults.length} global results loaded`
                  : `Search 3M+ global foods & restaurants for "${cleanQuery}"`}
              </Txt>
            </View>

            <Pressable
              onPress={() => triggerOnlineSearch(cleanQuery)}
              disabled={isSearchingOnline}
              style={({ pressed }) => [st.onlineSearchBtn, pressed && { opacity: 0.8 }]}
            >
              {isSearchingOnline ? (
                <ActivityIndicator size="small" color="#051510" />
              ) : (
                <>
                  <Ionicons name="search" size={14} color="#051510" />
                  <Txt size="xs" weight="800" color="#051510">
                    {searchedOnlineQuery === cleanQuery ? 'Refresh' : 'Smart Search'}
                  </Txt>
                </>
              )}
            </Pressable>
          </View>
        </Card>
      ) : null}

      {/* 4. OPEN FOOD FACTS RESULTS (IF ANY) */}
      {openFoodResults.length > 0 ? (
        <Card style={{ padding: 12, borderColor: C.accent, borderWidth: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="globe-outline" size={16} color={C.accent} />
              <Txt size="sm" weight="800" color={C.accent}>
                {`Global / Online Results (${openFoodResults.length} items)`}
              </Txt>
            </View>
            <Txt size="xs" color={C.dimmer}>Tap item to log or save</Txt>
          </View>

          {openFoodResults.map((p, idx) => (
            <View key={p.barcode || `${p.name}-${idx}`}>
              {idx > 0 ? <Divider /> : null}
              <Pressable
                onPress={() => setModalOpenProduct(p)}
                style={({ pressed }) => [st.foodRow, pressed && { opacity: 0.7 }]}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Txt size="md" weight="700" numberOfLines={1}>
                      {p.name}
                    </Txt>
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {p.brand ? (
                      <View style={st.brandTag}>
                        <Txt size="xs" weight="700" color={C.dim}>
                          {p.brand}
                        </Txt>
                      </View>
                    ) : null}
                    <Txt size="xs" weight="700" color={C.protein}>
                      {`${fmtInt(p.proteinPer100g)}P`}
                    </Txt>
                    <Txt size="xs" color={C.dimmer}>•</Txt>
                    <Txt size="xs" weight="700" color={C.carbs}>
                      {`${fmtInt(p.carbsPer100g)}C`}
                    </Txt>
                    <Txt size="xs" color={C.dimmer}>•</Txt>
                    <Txt size="xs" weight="700" color={C.fat}>
                      {`${fmtInt(p.fatPer100g)}F`}
                    </Txt>
                  </View>
                </View>

                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <View style={st.calBadge}>
                    <Txt size="sm" weight="800" color={C.kcal}>
                      {`${fmtInt(p.caloriesPer100g)} kcal`}
                    </Txt>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Txt size="xs" weight="700" color={C.accent}>
                      + Log / Save
                    </Txt>
                    <Ionicons name="chevron-forward" size={12} color={C.accent} />
                  </View>
                </View>
              </Pressable>
            </View>
          ))}
        </Card>
      ) : null}

      {/* 5. LOCAL FOODS SECTION */}
      {foods === null ? null : foods.length === 0 ? (
        openFoodResults.length === 0 ? (
          <Card style={{ padding: 16, alignItems: 'center', gap: 10 }}>
            <Ionicons name="search-outline" size={32} color={C.dimmer} />
            <Txt size="md" weight="800" color={C.text}>
              {cleanQuery ? `No local food found for "${cleanQuery}"` : 'No foods found'}
            </Txt>
            <Txt size="xs" color={C.dim} align="center" style={{ maxWidth: 320 }}>
              {cleanQuery
                ? 'Tap "Smart Search" to search millions of items on the global database, or create a custom food.'
                : 'Try searching for any food or selecting a category above.'}
            </Txt>
            {cleanQuery ? (
              <Pressable
                onPress={() => triggerOnlineSearch(cleanQuery)}
                disabled={isSearchingOnline}
                style={st.smartSearchCta}
              >
                {isSearchingOnline ? (
                  <ActivityIndicator size="small" color="#051510" />
                ) : (
                  <>
                    <Ionicons name="sparkles" size={15} color="#051510" />
                    <Txt size="xs" weight="800" color="#051510">
                      ⚡ Smart Search &quot;{cleanQuery}&quot;
                    </Txt>
                  </>
                )}
              </Pressable>
            ) : null}
          </Card>
        ) : null
      ) : (
        <Card style={{ padding: 12 }}>
          {openFoodResults.length > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Ionicons name="folder-outline" size={16} color={C.dim} />
              <Txt size="sm" weight="800" color={C.dim}>
                {`Local Database (${foods.length} items)`}
              </Txt>
            </View>
          ) : null}

          {foods.map((f, idx) => (
            <View key={f.id}>
              {idx > 0 ? <Divider /> : null}
              <Pressable
                onPress={() => setModalLocalFood(f)}
                style={({ pressed }) => [st.foodRow, pressed && { opacity: 0.7 }]}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Txt size="md" weight="700">
                      {f.food_name}
                    </Txt>
                    {f.is_seed === 0 ? (
                      <View style={st.customTag}>
                        <Txt size="xs" weight="800" color={C.accent}>
                          CUSTOM
                        </Txt>
                      </View>
                    ) : null}
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <Txt size="xs" weight="700" color={C.protein}>
                      {`${fmtInt(f.protein_per_100g)}P`}
                    </Txt>
                    <Txt size="xs" color={C.dimmer}>•</Txt>
                    <Txt size="xs" weight="700" color={C.carbs}>
                      {`${fmtInt(f.carbs_per_100g)}C`}
                    </Txt>
                    <Txt size="xs" color={C.dimmer}>•</Txt>
                    <Txt size="xs" weight="700" color={C.fat}>
                      {`${fmtInt(f.fat_per_100g)}F`}
                    </Txt>
                  </View>
                </View>

                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <View style={st.calBadge}>
                    <Txt size="sm" weight="800" color={C.kcal}>
                      {`${fmtInt(f.calories_per_100g)} kcal`}
                    </Txt>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={C.dimmer} />
                </View>
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      <Txt size="xs" color={C.dimmer} align="center" style={{ marginTop: 2 }}>
        {foods ? `${foods.length} local items` : ''}
        {openFoodResults.length > 0 ? ` · ${openFoodResults.length} Open Food Facts results` : ''} · Tap any item for options
      </Txt>

      {/* 6. MODAL FOR OPEN FOOD FACTS SELECTION */}
      <Modal
        visible={modalOpenProduct !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setModalOpenProduct(null)}
      >
        <Pressable
          style={st.modalOverlay}
          onPress={() => setModalOpenProduct(null)}
        >
          <Pressable
            style={st.modalCard}
            onPress={(e) => e.stopPropagation?.()}
          >
            {modalOpenProduct ? (
              <View style={{ gap: 14 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt size="lg" weight="900" color={C.text} style={{ letterSpacing: -0.4 }}>
                      {modalOpenProduct.name}
                    </Txt>
                    {modalOpenProduct.brand ? (
                      <Txt size="xs" color={C.dim} weight="600">
                        Brand: {modalOpenProduct.brand}
                      </Txt>
                    ) : null}
                  </View>
                  <Pressable onPress={() => setModalOpenProduct(null)} style={{ padding: 4 }}>
                    <Ionicons name="close" size={20} color={C.dim} />
                  </Pressable>
                </View>

                {/* Macros Card */}
                <View style={st.modalMacroGrid}>
                  <View style={st.modalMacroBox}>
                    <Txt size="xs" color={C.dim} weight="700">CALORIES</Txt>
                    <Txt size="lg" weight="900" color={C.kcal}>{fmtInt(modalOpenProduct.caloriesPer100g)}</Txt>
                  </View>
                  <View style={st.modalMacroBox}>
                    <Txt size="xs" color={C.protein} weight="700">PROTEIN</Txt>
                    <Txt size="lg" weight="900" color={C.protein}>{fmtInt(modalOpenProduct.proteinPer100g)}g</Txt>
                  </View>
                  <View style={st.modalMacroBox}>
                    <Txt size="xs" color={C.carbs} weight="700">CARBS</Txt>
                    <Txt size="lg" weight="900" color={C.carbs}>{fmtInt(modalOpenProduct.carbsPer100g)}g</Txt>
                  </View>
                  <View style={st.modalMacroBox}>
                    <Txt size="xs" color={C.fat} weight="700">FAT</Txt>
                    <Txt size="lg" weight="900" color={C.fat}>{fmtInt(modalOpenProduct.fatPer100g)}g</Txt>
                  </View>
                </View>

                <Divider />

                {/* Actions */}
                <View style={{ gap: 8 }}>
                  <Button
                    title={savingAction ? 'Opening Scale…' : 'Log Food (Scale Weight)'}
                    onPress={() => onSaveOpenFoodToCustom(modalOpenProduct, true)}
                    disabled={savingAction}
                  />
                  <Button
                    title="Save to My Foods"
                    variant="secondary"
                    onPress={() => onSaveOpenFoodToCustom(modalOpenProduct, false)}
                    disabled={savingAction}
                  />
                  <Button
                    title="Edit & Customize Macros"
                    variant="ghost"
                    onPress={() => {
                      const p = modalOpenProduct;
                      const displayName = p.brand ? `${p.brand} - ${p.name}` : p.name;
                      setModalOpenProduct(null);
                      router.push({
                        pathname: '/edit-food',
                        params: {
                          name: displayName,
                          kcal: String(p.caloriesPer100g),
                          protein: String(p.proteinPer100g),
                          carbs: String(p.carbsPer100g),
                          fat: String(p.fatPer100g),
                          category: p.category,
                          barcode: p.barcode,
                        },
                      });
                    }}
                  />
                </View>
              </View>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* 7. MODAL FOR LOCAL FOOD SELECTION */}
      <Modal
        visible={modalLocalFood !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setModalLocalFood(null)}
      >
        <Pressable
          style={st.modalOverlay}
          onPress={() => setModalLocalFood(null)}
        >
          <Pressable
            style={st.modalCard}
            onPress={(e) => e.stopPropagation?.()}
          >
            {modalLocalFood ? (
              <View style={{ gap: 14 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt size="lg" weight="900" color={C.text} style={{ letterSpacing: -0.4 }}>
                      {modalLocalFood.food_name}
                    </Txt>
                    <Txt size="xs" color={C.dim} weight="600">
                      {modalLocalFood.category} · {modalLocalFood.is_seed ? 'Standard Reference Food' : 'Custom Item'}
                    </Txt>
                  </View>
                  <Pressable onPress={() => setModalLocalFood(null)} style={{ padding: 4 }}>
                    <Ionicons name="close" size={20} color={C.dim} />
                  </Pressable>
                </View>

                {/* Macros Card */}
                <View style={st.modalMacroGrid}>
                  <View style={st.modalMacroBox}>
                    <Txt size="xs" color={C.dim} weight="700">CALORIES</Txt>
                    <Txt size="lg" weight="900" color={C.kcal}>{fmtInt(modalLocalFood.calories_per_100g)}</Txt>
                  </View>
                  <View style={st.modalMacroBox}>
                    <Txt size="xs" color={C.protein} weight="700">PROTEIN</Txt>
                    <Txt size="lg" weight="900" color={C.protein}>{fmtInt(modalLocalFood.protein_per_100g)}g</Txt>
                  </View>
                  <View style={st.modalMacroBox}>
                    <Txt size="xs" color={C.carbs} weight="700">CARBS</Txt>
                    <Txt size="lg" weight="900" color={C.carbs}>{fmtInt(modalLocalFood.carbs_per_100g)}g</Txt>
                  </View>
                  <View style={st.modalMacroBox}>
                    <Txt size="xs" color={C.fat} weight="700">FAT</Txt>
                    <Txt size="lg" weight="900" color={C.fat}>{fmtInt(modalLocalFood.fat_per_100g)}g</Txt>
                  </View>
                </View>

                <Divider />

                {/* Actions */}
                <View style={{ gap: 8 }}>
                  <Button
                    title="Log Food (Scale Weight)"
                    onPress={() => {
                      const id = modalLocalFood.id;
                      setModalLocalFood(null);
                      router.push({ pathname: '/add-entry', params: { foodId: String(id) } });
                    }}
                  />
                  {modalLocalFood.is_seed ? (
                    <Button
                      title="Duplicate to Custom Foods"
                      variant="secondary"
                      onPress={() => {
                        const f = modalLocalFood;
                        setModalLocalFood(null);
                        router.push({
                          pathname: '/edit-food',
                          params: {
                            name: f.food_name,
                            kcal: String(f.calories_per_100g),
                            protein: String(f.protein_per_100g),
                            carbs: String(f.carbs_per_100g),
                            fat: String(f.fat_per_100g),
                            category: f.category,
                          },
                        });
                      }}
                    />
                  ) : (
                    <>
                      <Button
                        title="Edit Custom Food"
                        variant="secondary"
                        onPress={() => {
                          const id = modalLocalFood.id;
                          setModalLocalFood(null);
                          router.push({ pathname: '/edit-food', params: { foodId: String(id) } });
                        }}
                      />
                      <Button
                        title="Delete Food"
                        variant="danger"
                        onPress={() => handleDeleteLocalFood(modalLocalFood)}
                      />
                    </>
                  )}
                </View>
              </View>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const st = StyleSheet.create({
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceAlt,
    borderRadius: 14,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: C.border,
    gap: 6,
  },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.blueSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 2,
  },
  onlineBanner: {
    backgroundColor: C.surfaceAlt,
    borderColor: C.accentSoft,
    borderWidth: 1,
    padding: 12,
  },
  onlineSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.accent,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  smartSearchCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.accent,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 4,
  },
  foodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  customTag: {
    backgroundColor: C.accentSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  brandTag: {
    backgroundColor: C.surfaceHi,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  per100Tag: {
    backgroundColor: C.surfaceHi,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  calBadge: {
    backgroundColor: C.blueSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  toastBanner: {
    backgroundColor: C.accent,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 20,
  },
  modalMacroGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  modalMacroBox: {
    flex: 1,
    backgroundColor: C.surfaceAlt,
    padding: 8,
    borderRadius: 8,
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: C.border,
  },
  modalHelperTag: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: C.surfaceAlt,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
});
