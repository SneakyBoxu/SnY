import { useCallback, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { router, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import {
  C,
  Spacing,
  THEME_OPTIONS,
  applyTheme,
  createCustomTheme,
  getActiveThemeId,
  hslToHex,
  type DarkBase,
  type ThemeId,
} from '@/constants/theme';
import { fmtInt, fmtNum, fmtSigned, parseNumber } from '@/lib/num';
import { PHASES, type AppSettings } from '@/lib/types';
import { KCAL_PER_KG_PER_DAY } from '@/lib/tdee';
import { useDb } from '@/db/db';
import { recalculateAll } from '@/db/recalc';
import { countFoods, getSettings, saveSettings } from '@/db/queries';
import { countWorkoutDays } from '@/db/workouts';
import {
  Button,
  Card,
  CardTitle,
  ConfirmModal,
  Divider,
  NumberField,
  Row,
  Screen,
  Segmented,
  Stepper,
  Txt,
} from '@/components/ui';

const ACTIVITY_OPTIONS: [string, number][] = [
  ['Sedentary', 1.2],
  ['Light', 1.35],
  ['Moderate', 1.55],
  ['High', 1.725],
];

const DEFAULT_ACTIVITY = 1.375;

const QUICK_ACCENTS = [
  { label: 'Emerald', h: 160, l: 40, hex: '#10B981' },
  { label: 'Lime', h: 84, l: 48, hex: '#84CC16' },
  { label: 'Cyan', h: 188, l: 45, hex: '#06B6D4' },
  { label: 'Sky', h: 200, l: 55, hex: '#38BDF8' },
  { label: 'Violet', h: 270, l: 60, hex: '#8B5CF6' },
  { label: 'Pink', h: 330, l: 55, hex: '#EC4899' },
  { label: 'Crimson', h: 0, l: 55, hex: '#EF4444' },
  { label: 'Amber', h: 38, l: 50, hex: '#F59E0B' },
];

const DARK_BASES: { id: DarkBase; label: string; preview: string }[] = [
  { id: 'oled', label: 'Pitch OLED (0%)', preview: '#000000' },
  { id: 'obsidian', label: 'Obsidian Slate', preview: '#080B10' },
  { id: 'midnight', label: 'Midnight Navy', preview: '#060A14' },
  { id: 'charcoal', label: 'Charcoal Carbon', preview: '#0E1015' },
];

export default function SettingsScreen() {
  const db = useDb();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [ageStr, setAgeStr] = useState('');
  const [heightStr, setHeightStr] = useState('');
  const [floorStr, setFloorStr] = useState('');
  const [manualStr, setManualStr] = useState('');
  const [foodCount, setFoodCount] = useState(0);
  const [sessions, setSessions] = useState(0);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<ThemeId>(getActiveThemeId());

  // Custom Theme Studio State
  const [showCustomThemeModal, setShowCustomThemeModal] = useState(false);
  const [customHue, setCustomHue] = useState(270);
  const [customLightness, setCustomLightness] = useState(55);
  const [customBase, setCustomBase] = useState<DarkBase>('obsidian');
  const [hueTrackWidth, setHueTrackWidth] = useState(280);
  const [lightTrackWidth, setLightTrackWidth] = useState(280);

  const refreshScreen = useCallback(async () => {
    const s = await getSettings(db);
    setSettings(s);
    setAgeStr(String(s.age));
    setHeightStr(String(s.height_cm));
    setFloorStr(String(s.calorie_floor));
    setManualStr(s.manual_target_calories !== null ? String(s.manual_target_calories) : '');
    setFoodCount(await countFoods(db));
    setSessions(await countWorkoutDays(db));
    try {
      const tRow = await db.getFirstAsync<{ value: string }>(
        "SELECT value FROM settings WHERE key = 'app_theme'",
      );
      if (tRow?.value) {
        setCurrentTheme(tRow.value as ThemeId);
      }
      const cfgRow = await db.getFirstAsync<{ value: string }>(
        "SELECT value FROM settings WHERE key = 'custom_theme_config'",
      );
      if (cfgRow?.value) {
        const parsed = JSON.parse(cfgRow.value);
        if (parsed.base) setCustomBase(parsed.base);
      }
    } catch {}
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      refreshScreen();
    }, [refreshScreen]),
  );

  if (!settings) {
    return <Screen title="Settings" loading />;
  }

  const persist = async (changes: Partial<AppSettings>) => {
    const next = { ...settings, ...changes };
    setSettings(next);
    await saveSettings(db, changes);
    await recalculateAll(db);
  };

  const checkForUpdates = async () => {
    if (Platform.OS === 'web') {
      setUpdateMsg('Web version — just refresh the page to get the latest code.');
      return;
    }
    setCheckingUpdate(true);
    setUpdateMsg(null);
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        setUpdateMsg('✅ You are on the latest version.');
      } else {
        setUpdateMsg('⬇️ Update found — downloading…');
        await Updates.fetchUpdateAsync();
        setUpdateMsg('✅ Update downloaded. Restart the app to apply it.');
        setUpdateReady(true);
      }
    } catch (e) {
      setUpdateMsg(`❌ Update check failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const applyUpdateNow = async () => {
    setUpdateReady(false);
    try {
      await Updates.reloadAsync();
    } catch {
      setUpdateMsg('❌ Could not restart automatically. Close and reopen the app.');
    }
  };

  const activityLabel =
    ACTIVITY_OPTIONS.find(([, v]) => Math.abs(v - settings.activity_multiplier) < 0.001)?.[0] ??
    'Light';

  const rateDelta = Math.round(settings.goal_rate_kg_per_week * KCAL_PER_KG_PER_DAY);

  const commitNumber = async (
    str: string,
    key: keyof AppSettings,
    min: number,
    max: number,
  ) => {
    const n = parseNumber(str);
    if (n === null) return;
    await persist({ [key]: Math.min(max, Math.max(min, n)) } as Partial<AppSettings>);
  };

  const handleSelectTheme = async (themeId: ThemeId) => {
    if (themeId === 'custom') {
      setShowCustomThemeModal(true);
      return;
    }
    if (themeId === currentTheme) return;
    setCurrentTheme(themeId);
    applyTheme(themeId);
    try {
      await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('app_theme', ?)", [themeId]);
    } catch {}
    if (Platform.OS === 'web') {
      window.location.reload();
    } else {
      try {
        await Updates.reloadAsync();
      } catch {
        // Fallback for development mode
      }
    }
  };

  const handleHueTouch = (x: number) => {
    if (hueTrackWidth <= 0) return;
    const clamped = Math.max(0, Math.min(hueTrackWidth, x));
    const h = Math.round((clamped / hueTrackWidth) * 360);
    setCustomHue(h);
  };

  const handleLightnessTouch = (x: number) => {
    if (lightTrackWidth <= 0) return;
    const clamped = Math.max(0, Math.min(lightTrackWidth, x));
    const l = Math.round(30 + (clamped / lightTrackWidth) * 45);
    setCustomLightness(l);
  };

  const currentCustomHex = hslToHex(customHue, 95, customLightness);
  const currentPreviewTheme = createCustomTheme(currentCustomHex, customBase);

  const handleApplyCustomTheme = async () => {
    const cfg = { accent: currentCustomHex, base: customBase };
    setCurrentTheme('custom');
    applyTheme('custom', cfg);
    try {
      await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('app_theme', 'custom')", []);
      await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('custom_theme_config', ?)", [
        JSON.stringify(cfg),
      ]);
    } catch {}
    setShowCustomThemeModal(false);
    if (Platform.OS === 'web') {
      window.location.reload();
    } else {
      try {
        await Updates.reloadAsync();
      } catch {}
    }
  };

  return (
    <Screen title="Program & Strategy" subtitle="MacroFactor-style adaptive metabolic configuration">
      {/* 0. SET NEW GOAL HERO BANNER */}
      <Card highlight style={{ borderColor: C.accent, borderWidth: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="flag" size={16} color={C.accent} />
              <Txt size="md" weight="900" color={C.text}>
                {`Target: ${fmtNum(settings.target_weight_kg ?? 70, 1)} kg (${settings.phase})`}
              </Txt>
            </View>
            <Txt size="xs" color={C.dim} weight="600">
              {`${fmtSigned(settings.goal_rate_kg_per_week, 2)} kg / week · ${fmtSigned(rateDelta, 0)} kcal/day delta`}
            </Txt>
          </View>

          <Button
            title="Set New Goal ›"
            small
            onPress={() => router.push('/set-goal' as any)}
          />
        </View>
      </Card>

      {/* 1. STRATEGY HERO CARD */}
      <Card>
        <CardTitle icon={<Ionicons name="flag-outline" size={16} color={C.accent} />}>
          ACTIVE STRATEGY & PHASE
        </CardTitle>

        <View style={{ gap: 6, marginTop: 4 }}>
          <Txt size="xs" color={C.dimmer} weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
            Phase Selector
          </Txt>
          <Segmented
            options={[...PHASES]}
            value={settings.phase}
            onChange={(v) => persist({ phase: v as AppSettings['phase'] })}
          />
        </View>

        <Row
          title="Weekly Goal Rate"
          sub={`${fmtSigned(rateDelta, 0)} kcal/day calculated net deficit/surplus`}
          right={
            <Stepper
              value={settings.goal_rate_kg_per_week}
              onChange={(n) => persist({ goal_rate_kg_per_week: n })}
              step={0.05}
              min={-1.0}
              max={0.75}
              decimals={2}
              format={(n) => `${fmtSigned(n, 2)} kg`}
            />
          }
        />

        <Divider />

        <View style={{ gap: 6 }}>
          <View style={{ gap: 2 }}>
            <Txt size="xs" color={C.dimmer} weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Target Mode
            </Txt>
            <Txt size="xs" color={C.dim} weight="500">
              {settings.manual_target_calories !== null ? 'Fixed target override' : 'Dynamically managed by TDEE algorithm'}
            </Txt>
          </View>
          <Segmented
            options={['Auto', 'Manual']}
            value={settings.manual_target_calories !== null ? 'Manual' : 'Auto'}
            onChange={(v) => {
              if (v === 'Manual') {
                persist({ manual_target_calories: 2000 });
              } else {
                persist({ manual_target_calories: null });
              }
            }}
          />
        </View>

        {settings.manual_target_calories !== null ? (
          <NumberField
            label="Manual Target Override"
            value={manualStr}
            onChangeText={setManualStr}
            onCommit={() => {
              const n = parseNumber(manualStr);
              if (n !== null) persist({ manual_target_calories: Math.round(n) });
            }}
            suffix="kcal"
          />
        ) : null}

        <NumberField
          label="Deficit Floor (Lean Mass Protection)"
          value={floorStr}
          onChangeText={setFloorStr}
          onCommit={() => commitNumber(floorStr, 'calorie_floor', 1000, 4000)}
          suffix="kcal"
        />
        <Txt size="xs" color={C.dimmer} weight="500">
          The adaptive algorithm will never drop target calories below this floor to preserve strength numbers.
        </Txt>
      </Card>

      {/* 2. MACRO TARGET RATIOS */}
      <Card>
        <CardTitle icon={<Ionicons name="pie-chart-outline" size={16} color={C.protein} />}>
          MACRONUTRIENT RATIOS
        </CardTitle>
        <Row
          title="Protein Target"
          sub="Strategy: ~2.0 g/kg (Phase 2 Cut: 140–165g)"
          right={
            <Stepper
              value={settings.protein_g_per_kg}
              onChange={(n) => persist({ protein_g_per_kg: n })}
              step={0.1}
              min={1.2}
              max={3.0}
              decimals={2}
              format={(n) => `${n.toFixed(1)} g/kg`}
            />
          }
        />
        <Divider />
        <Row
          title="Fat Minimum Floor"
          sub="Essential hormone production (Carbs fill remaining)"
          right={
            <Stepper
              value={settings.fat_g_per_kg}
              onChange={(n) => persist({ fat_g_per_kg: n })}
              step={0.05}
              min={0.3}
              max={1.5}
              decimals={2}
              format={(n) => `${n.toFixed(2)} g/kg`}
            />
          }
        />
      </Card>

      {/* 3. PROFILE & ESTIMATE BASELINE */}
      <Card>
        <CardTitle icon={<Ionicons name="person-outline" size={16} color={C.blue} />}>
          ANTHROPOMETRIC BASELINE
        </CardTitle>
        <View style={{ gap: 6 }}>
          <Txt size="xs" color={C.dimmer} weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
            Biological Sex
          </Txt>
          <Segmented
            options={['Male', 'Female']}
            value={settings.sex === 'male' ? 'Male' : 'Female'}
            onChange={(v) => persist({ sex: v === 'Male' ? 'male' : 'female' })}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <NumberField
            label="Age"
            value={ageStr}
            onChangeText={setAgeStr}
            onCommit={() => commitNumber(ageStr, 'age', 13, 100)}
            suffix="yrs"
            style={{ flex: 1 }}
          />
          <NumberField
            label="Height"
            value={heightStr}
            onChangeText={setHeightStr}
            onCommit={() => commitNumber(heightStr, 'height_cm', 120, 230)}
            suffix="cm"
            style={{ flex: 1 }}
          />
        </View>
        <View style={{ gap: Spacing.xs, marginTop: 4 }}>
          <Txt size="sm" weight="700">
            Activity Level (Baseline Fallback)
          </Txt>
          <Segmented
            options={ACTIVITY_OPTIONS.map((o) => o[0])}
            value={activityLabel}
            onChange={(label) =>
              persist({
                activity_multiplier:
                  ACTIVITY_OPTIONS.find((o) => o[0] === label)?.[1] ?? DEFAULT_ACTIVITY,
              })
            }
          />
        </View>
      </Card>

      {/* 4. THEME & APPEARANCE */}
      <Card>
        <CardTitle icon={<Ionicons name="color-palette-outline" size={16} color={C.accent} />}>
          THEME &amp; APPEARANCE
        </CardTitle>
        <Txt size="xs" color={C.dim} weight="500">
          Select an aesthetic preset to customize the color palette across the app.
        </Txt>

        <View style={st.themeGrid}>
          {THEME_OPTIONS.map((t) => {
            const active = currentTheme === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => handleSelectTheme(t.id)}
                android_ripple={{ color: 'rgba(255, 255, 255, 0.08)' }}
                style={({ pressed }) => [
                  st.themeCard,
                  { backgroundColor: t.previewBg },
                  active && [
                    st.themeCardActive,
                    {
                      borderColor: t.previewColor,
                      shadowColor: t.previewColor,
                    },
                  ],
                  pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
                ]}
              >
                {/* Top Row: Swatch Cluster + Selected Checkmark Badge */}
                <View style={st.themeCardTop}>
                  {/* Swatch Cluster: Surface capsule + Primary accent dot + Secondary accent dot */}
                  <View style={[st.swatchCluster, { backgroundColor: t.surfaceAlt, borderColor: t.border }]}>
                    <View style={[st.swatchDot, { backgroundColor: t.previewColor }]} />
                    <View style={[st.swatchDot, { backgroundColor: t.secondaryAccent }]} />
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {t.id === 'custom' ? (
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          setShowCustomThemeModal(true);
                        }}
                        hitSlop={8}
                        style={st.customEditIconBtn}
                      >
                        <Ionicons name="color-wand-outline" size={13} color={t.previewColor} />
                      </Pressable>
                    ) : null}

                    <View
                      style={[
                        st.checkBadge,
                        active
                          ? { backgroundColor: t.previewColor, borderColor: t.previewColor }
                          : { backgroundColor: 'transparent', borderColor: t.borderLight },
                      ]}
                    >
                      {active ? (
                        <Ionicons name="checkmark" size={11} color={t.onAccent} style={{ fontWeight: 'bold' }} />
                      ) : null}
                    </View>
                  </View>
                </View>

                {/* Bottom Row: Theme Name & Tagline */}
                <View style={{ gap: 2, marginTop: 10 }}>
                  <Txt size="sm" weight={active ? '900' : '700'} color={t.text}>
                    {t.name}
                  </Txt>
                  <Txt size="xs" weight="600" color={t.dim} numberOfLines={1}>
                    {t.tagline}
                  </Txt>
                </View>
              </Pressable>
            );
          })}
        </View>
      </Card>

      {/* CUSTOM THEME STUDIO MODAL */}
      <Modal
        visible={showCustomThemeModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCustomThemeModal(false)}
      >
        <Pressable style={st.modalOverlay} onPress={() => setShowCustomThemeModal(false)}>
          <Pressable style={st.modalCard} onPress={(e) => e.stopPropagation()}>
            {/* Header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ gap: 2 }}>
                <Txt size="lg" weight="900" color={C.text}>
                  Custom Color Studio
                </Txt>
                <Txt size="xs" color={C.dim} weight="600">
                  Slide to tune your custom hue &amp; lightness
                </Txt>
              </View>
              <Pressable onPress={() => setShowCustomThemeModal(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color={C.dim} />
              </Pressable>
            </View>

            <Divider />

            {/* LIVE THEME PREVIEW CARD */}
            <View
              style={[
                st.previewCardContainer,
                {
                  backgroundColor: currentPreviewTheme.surface,
                  borderColor: currentCustomHex,
                  shadowColor: currentCustomHex,
                },
              ]}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={[st.previewDot, { backgroundColor: currentCustomHex }]} />
                  <Txt size="sm" weight="900" color={currentPreviewTheme.text}>
                    Live Preview
                  </Txt>
                </View>
                <View style={[st.previewTag, { backgroundColor: currentPreviewTheme.accentSoft }]}>
                  <Txt size="xs" weight="800" color={currentCustomHex}>
                    {currentCustomHex}
                  </Txt>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <View style={[st.previewBtn, { backgroundColor: currentCustomHex }]}>
                  <Txt size="xs" weight="800" color={currentPreviewTheme.onAccent}>
                    Accent Button
                  </Txt>
                </View>
                <View
                  style={[
                    st.previewBtnSecondary,
                    { backgroundColor: currentPreviewTheme.surfaceHi, borderColor: currentPreviewTheme.border },
                  ]}
                >
                  <Txt size="xs" weight="700" color={currentPreviewTheme.text}>
                    Surface Card
                  </Txt>
                </View>
              </View>
            </View>

            {/* HUE SPECTRUM SLIDER */}
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Txt size="xs" weight="700" color={C.dim}>
                  HUE COLOR SPECTRUM
                </Txt>
                <Txt size="xs" weight="900" color={currentCustomHex}>
                  {`${customHue}°`}
                </Txt>
              </View>
              <View
                onLayout={(e) => setHueTrackWidth(e.nativeEvent.layout.width)}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={(e) => handleHueTouch(e.nativeEvent.locationX)}
                onResponderMove={(e) => handleHueTouch(e.nativeEvent.locationX)}
                style={st.sliderTrackWrapper}
              >
                <View
                  style={[
                    st.rainbowTrack,
                    Platform.OS === 'web'
                      ? ({
                          backgroundImage:
                            'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
                        } as any)
                      : null,
                  ]}
                >
                  {Platform.OS !== 'web' ? (
                    ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'].map((c, i) => (
                      <View key={i} style={{ flex: 1, backgroundColor: c }} />
                    ))
                  ) : null}
                </View>
                <View
                  style={[
                    st.sliderThumb,
                    {
                      left: Math.max(0, Math.min(hueTrackWidth - 26, (customHue / 360) * hueTrackWidth - 13)),
                      backgroundColor: currentCustomHex,
                    },
                  ]}
                />
              </View>
            </View>

            {/* LIGHTNESS / VIBRANCY SLIDER */}
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Txt size="xs" weight="700" color={C.dim}>
                  BRIGHTNESS &amp; VIBRANCY
                </Txt>
                <Txt size="xs" weight="900" color={currentCustomHex}>
                  {`${customLightness}%`}
                </Txt>
              </View>
              <View
                onLayout={(e) => setLightTrackWidth(e.nativeEvent.layout.width)}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={(e) => handleLightnessTouch(e.nativeEvent.locationX)}
                onResponderMove={(e) => handleLightnessTouch(e.nativeEvent.locationX)}
                style={st.sliderTrackWrapper}
              >
                <View
                  style={[
                    st.rainbowTrack,
                    Platform.OS === 'web'
                      ? ({
                          backgroundImage: `linear-gradient(to right, #1a1a1a, ${hslToHex(customHue, 100, 50)}, #ffffff)`,
                        } as any)
                      : null,
                  ]}
                >
                  {Platform.OS !== 'web' ? (
                    [25, 45, 60, 75].map((l, i) => (
                      <View key={i} style={{ flex: 1, backgroundColor: hslToHex(customHue, 95, l) }} />
                    ))
                  ) : null}
                </View>
                <View
                  style={[
                    st.sliderThumb,
                    {
                      left: Math.max(
                        0,
                        Math.min(
                          lightTrackWidth - 26,
                          ((customLightness - 30) / 45) * lightTrackWidth - 13,
                        ),
                      ),
                      backgroundColor: currentCustomHex,
                    },
                  ]}
                />
              </View>
            </View>

            {/* QUICK SWATCH SHORTCUTS */}
            <View style={{ gap: 6 }}>
              <Txt size="xs" weight="700" color={C.dim}>
                QUICK ACCENT SHORTCUTS
              </Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {QUICK_ACCENTS.map((sw) => (
                  <Pressable
                    key={sw.label}
                    onPress={() => {
                      setCustomHue(sw.h);
                      setCustomLightness(sw.l);
                    }}
                    style={({ pressed }) => [
                      st.quickSwatchPill,
                      { backgroundColor: sw.hex + '22', borderColor: sw.hex },
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <View style={[st.quickDot, { backgroundColor: sw.hex }]} />
                    <Txt size="xs" weight="700" color={C.text}>
                      {sw.label}
                    </Txt>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* BACKGROUND BASE DARKNESS */}
            <View style={{ gap: 6 }}>
              <Txt size="xs" weight="700" color={C.dim}>
                BACKGROUND DARKNESS
              </Txt>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {DARK_BASES.map((b) => {
                  const active = customBase === b.id;
                  return (
                    <Pressable
                      key={b.id}
                      onPress={() => setCustomBase(b.id)}
                      style={[
                        st.baseOptionChip,
                        { backgroundColor: b.preview },
                        active && { borderColor: currentCustomHex, borderWidth: 2 },
                      ]}
                    >
                      <Txt size="xs" weight={active ? '900' : '600'} color={active ? '#FFFFFF' : C.dim}>
                        {b.label}
                      </Txt>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Divider />

            {/* Action Buttons */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Cancel"
                  variant="secondary"
                  onPress={() => setShowCustomThemeModal(false)}
                />
              </View>
              <View style={{ flex: 2 }}>
                <Pressable
                  onPress={handleApplyCustomTheme}
                  style={({ pressed }) => [
                    st.applyCustomBtn,
                    { backgroundColor: currentCustomHex },
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Txt size="md" weight="800" color={currentPreviewTheme.onAccent} align="center">
                    Apply Custom Theme
                  </Txt>
                </Pressable>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 5. APP UPDATES */}
      <Card>
        <CardTitle icon={<Ionicons name="cloud-download-outline" size={16} color={C.accent} />}>
          APP UPDATES
        </CardTitle>
        <Row
          title={`Version ${Constants.expoConfig?.version ?? '1.0.1'}`}
          sub="Over-the-air updates apply bug fixes without reinstalling"
        />
        {updateMsg ? (
          <View style={{ backgroundColor: C.surfaceHi, padding: 10, borderRadius: 8 }}>
            <Txt size="xs" color={C.text} weight="600">
              {updateMsg}
            </Txt>
          </View>
        ) : null}
        <Button
          title={checkingUpdate ? 'Checking…' : 'Check for Updates'}
          small
          onPress={checkForUpdates}
          disabled={checkingUpdate}
        />
      </Card>

      {/* Update restart confirmation */}
      <ConfirmModal
        visible={updateReady}
        title="Apply Update Now?"
        message="The update has been downloaded. Restart the app to run the new version."
        confirmText="Restart Now"
        cancelText="Later"
        onConfirm={applyUpdateNow}
        onCancel={() => setUpdateReady(false)}
      />

      {/* 5. ADVANCED SETTINGS LINK */}
      <Card>
        <Pressable
          onPress={() => router.push('/advanced-settings' as never)}
          style={({ pressed }) => [
            { flexDirection: 'row', alignItems: 'center', gap: 12 },
            pressed && { opacity: 0.8 },
          ]}
        >
          <View style={st.advIconCircle}>
            <Ionicons name="options-outline" size={20} color={C.blue} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt size="md" weight="800" color={C.text}>
              Advanced Settings
            </Txt>
            <Txt size="xs" color={C.dim}>
              Backup &amp; restore, algorithm tuning, connection test
            </Txt>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.dim} />
        </Pressable>
      </Card>

      {/* 5. APP INFO */}
      <Card>
        <CardTitle icon={<Ionicons name="information-circle-outline" size={16} color={C.dim} />}>
          SYSTEM INFO
        </CardTitle>
        <Row title="Architecture" right={<Txt size="sm" color={C.dim} weight="600">Offline-First SQLite</Txt>} />
        <Divider />
        <Row title="Food Catalog" right={<Txt size="sm" color={C.dim} weight="600">{fmtInt(foodCount)} seed foods</Txt>} />
        <Divider />
        <Row title="Workout Database" right={<Txt size="sm" color={C.dim} weight="600">{fmtInt(sessions)} historical sessions</Txt>} />
        <Divider />
        <Txt size="xs" color={C.dimmer} weight="500">
          100% privacy-first. All biometric logs, weight trends, and TDEE math run strictly locally on this device.
        </Txt>
      </Card>
    </Screen>
  );
}

const st = StyleSheet.create({
  advIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
  },
  themeCard: {
    width: '48.3%',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1.5,
    borderColor: C.border,
    justifyContent: 'space-between',
    minHeight: 104,
  },
  themeCardActive: {
    borderWidth: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 4,
  },
  themeCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  swatchCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  swatchDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
  },
  checkBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customEditIconBtn: {
    padding: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 18,
    width: '100%',
    maxWidth: 440,
    borderWidth: 1,
    borderColor: C.borderLight,
    gap: 12,
  },
  previewCardContainer: {
    borderRadius: 14,
    padding: 12,
    borderWidth: 1.5,
    gap: 8,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 3,
  },
  previewDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  previewTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  previewBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  previewBtnSecondary: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  sliderTrackWrapper: {
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    position: 'relative',
  },
  rainbowTrack: {
    height: 14,
    borderRadius: 7,
    width: '100%',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  sliderThumb: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  quickSwatchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  quickDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  baseOptionChip: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyCustomBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
