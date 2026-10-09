import { useCallback, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { router, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { C, Spacing } from '@/constants/theme';
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

  const refreshScreen = useCallback(async () => {
    const s = await getSettings(db);
    setSettings(s);
    setAgeStr(String(s.age));
    setHeightStr(String(s.height_cm));
    setFloorStr(String(s.calorie_floor));
    setManualStr(s.manual_target_calories !== null ? String(s.manual_target_calories) : '');
    setFoodCount(await countFoods(db));
    setSessions(await countWorkoutDays(db));
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

      {/* 4. APP UPDATES */}
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
});
