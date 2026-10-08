import { useCallback, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { C } from '@/constants/theme';
import type { AppSettings } from '@/lib/types';
import {
  backupFileName,
  createBackup,
  parseBackup,
  pickBackupFileText,
  restoreBackup,
  saveBackupFile,
} from '@/lib/backup';
import { useDb } from '@/db/db';
import { recalculateAll } from '@/db/recalc';
import { getSettings, saveSettings } from '@/db/queries';
import { searchOpenFoodFacts } from '@/services/openFoodFacts';
import { testGeminiKey } from '@/services/geminiVision';
import {
  Button,
  Card,
  CardTitle,
  ConfirmModal,
  Divider,
  Row,
  Screen,
  Stepper,
  Txt,
} from '@/components/ui';

export default function AdvancedSettingsScreen() {
  const db = useDb();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [testingApi, setTestingApi] = useState(false);
  const [apiStatusMsg, setApiStatusMsg] = useState<string | null>(null);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [busyBackup, setBusyBackup] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [restoreConfirmVisible, setRestoreConfirmVisible] = useState(false);
  const [geminiKeyStr, setGeminiKeyStr] = useState('');
  const [testingKey, setTestingKey] = useState(false);
  const [keyStatusMsg, setKeyStatusMsg] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const s = await getSettings(db);
        setSettings(s);
        setGeminiKeyStr(s.gemini_api_key ?? '');
        const backupRow = await db.getFirstAsync<{ value: string }>(
          "SELECT value FROM settings WHERE key = 'last_backup_at'",
        );
        setLastBackupAt(backupRow?.value ?? null);
      })();
    }, [db]),
  );

  if (!settings) {
    return <Screen title="Advanced Settings" loading />;
  }

  const persist = async (changes: Partial<AppSettings>) => {
    const next = { ...settings, ...changes };
    setSettings(next);
    await saveSettings(db, changes);
    await recalculateAll(db);
  };

  const commitGeminiKey = async (value: string) => {
    await persist({ gemini_api_key: value.trim() });
  };

  const handleTestKey = async () => {
    setTestingKey(true);
    setKeyStatusMsg(null);
    try {
      const message = await testGeminiKey(geminiKeyStr);
      if (geminiKeyStr.trim() !== (settings.gemini_api_key ?? '')) {
        await commitGeminiKey(geminiKeyStr);
      }
      setKeyStatusMsg(`✅ ${message}`);
    } catch (e) {
      setKeyStatusMsg(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTestingKey(false);
    }
  };

  const testOpenFoodConnection = async () => {
    setTestingApi(true);
    setApiStatusMsg(null);
    try {
      const results = await searchOpenFoodFacts('tuna', 3);
      if (results && results.length > 0) {
        setApiStatusMsg(`✅ Connected! Found "${results[0].name}" (${results[0].caloriesPer100g} kcal/100g)`);
      } else {
        setApiStatusMsg('⚠️ No results returned, but server is reachable.');
      }
    } catch {
      setApiStatusMsg('❌ Connection error. Check your internet connection.');
    } finally {
      setTestingApi(false);
    }
  };

  const handleExportBackup = async () => {
    setBusyBackup(true);
    setBackupMsg(null);
    try {
      const backup = await createBackup(db);
      await saveBackupFile(JSON.stringify(backup), backupFileName());
      const now = new Date().toISOString();
      await db.runAsync(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('last_backup_at', ?)",
        [now],
      );
      setLastBackupAt(now);
      setBackupMsg('✅ Backup downloaded. Keep the file somewhere safe (cloud drive, email, etc.).');
    } catch (e) {
      setBackupMsg(`❌ Backup failed: ${String(e)}`);
    } finally {
      setBusyBackup(false);
    }
  };

  const runRestore = async () => {
    setBusyBackup(true);
    setBackupMsg(null);
    try {
      const text = await pickBackupFileText();
      if (text === null) return;
      const data = parseBackup(text);
      await restoreBackup(db, data);
      await recalculateAll(db);
      const s = await getSettings(db);
      setSettings(s);
      const backupRow = await db.getFirstAsync<{ value: string }>(
        "SELECT value FROM settings WHERE key = 'last_backup_at'",
      );
      setLastBackupAt(backupRow?.value ?? null);
      setBackupMsg('✅ Backup restored successfully. All data was replaced from the file.');
    } catch (e) {
      setBackupMsg(`❌ Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyBackup(false);
    }
  };

  return (
    <Screen
      title="Advanced Settings"
      subtitle="Algorithm tuning, backups and developer tools"
      onBack={() => router.back()}
    >
      {/* 1. ADAPTIVE ENGINE TUNING */}
      <Card>
        <CardTitle icon={<Ionicons name="hardware-chip-outline" size={16} color={C.weight} />}>
          ADAPTIVE ALGORITHM PARAMETERS
        </CardTitle>
        <Row
          title="Weight Smoothing (α)"
          sub="EWMA noise filter (0.12 recommended for scale fluctuation)"
          right={
            <Stepper
              value={settings.weight_alpha}
              onChange={(n) => persist({ weight_alpha: n })}
              step={0.01}
              min={0.05}
              max={0.3}
              decimals={2}
              format={(n) => n.toFixed(2)}
            />
          }
        />
        <Divider />
        <Row
          title="TDEE Smoothing (α)"
          sub="Metabolic burn reaction velocity"
          right={
            <Stepper
              value={settings.tdee_alpha}
              onChange={(n) => persist({ tdee_alpha: n })}
              step={0.05}
              min={0.1}
              max={0.6}
              decimals={2}
              format={(n) => n.toFixed(2)}
            />
          }
        />
      </Card>

      {/* 2. OPEN FOOD FACTS API INTEGRATION */}
      <Card>
        <CardTitle icon={<Ionicons name="globe-outline" size={16} color={C.accent} />}>
          OPEN FOOD FACTS INTEGRATION
        </CardTitle>
        <View style={{ gap: 6 }}>
          <Txt size="sm" color={C.text} weight="700">
            Open &amp; Free Public Food Database
          </Txt>
          <Txt size="xs" color={C.dim} weight="500">
            Connected via compliant User-Agent headers (`CalInCalOut/1.0.0`). Open Food Facts provides free, open access to over 3,000,000 foods and barcodes without requiring any paid subscriptions or API keys.
          </Txt>
        </View>
        <Divider />
        <Row
          title="User-Agent Header"
          sub="Compliant identifier for anti-bot & rate-limit exemption"
          right={
            <Txt size="xs" color={C.accent} weight="700">
              Active
            </Txt>
          }
        />
        {apiStatusMsg ? (
          <View style={{ backgroundColor: C.surfaceHi, padding: 10, borderRadius: 8, marginTop: 4 }}>
            <Txt size="xs" color={C.text} weight="600">
              {apiStatusMsg}
            </Txt>
          </View>
        ) : null}
        <Button
          title={testingApi ? 'Testing Connection…' : 'Test API Connection'}
          variant="secondary"
          onPress={testOpenFoodConnection}
          disabled={testingApi}
        />
      </Card>

      {/* 3. GEMINI AI KEY */}
      <Card>
        <CardTitle icon={<Ionicons name="sparkles-outline" size={16} color={C.blue} />}>
          GEMINI AI INTEGRATION
        </CardTitle>
        <View style={{ gap: 6 }}>
          <Txt size="sm" color={C.text} weight="700">
            Your Personal AI Key
          </Txt>
          <Txt size="xs" color={C.dim} weight="500">
            Powers AI Meal Scan and AI Quick Log. Get a free key at aistudio.google.com/apikey — it is stored only on this device, never uploaded.
          </Txt>
        </View>
        <Divider />
        <TextInput
          value={geminiKeyStr}
          onChangeText={setGeminiKeyStr}
          onBlur={() => commitGeminiKey(geminiKeyStr)}
          onSubmitEditing={() => commitGeminiKey(geminiKeyStr)}
          placeholder="Paste your Gemini API key (AIza...)"
          placeholderTextColor={C.dimmer}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={st.apiKeyInput}
        />
        {keyStatusMsg ? (
          <View style={{ backgroundColor: C.surfaceHi, padding: 10, borderRadius: 8 }}>
            <Txt size="xs" color={C.text} weight="600">
              {keyStatusMsg}
            </Txt>
          </View>
        ) : null}
        <Button
          title={testingKey ? 'Testing AI Key…' : 'Test AI Key'}
          variant="secondary"
          onPress={handleTestKey}
          disabled={testingKey}
        />
      </Card>

      {/* 4. DATA & BACKUP */}
      <Card>
        <CardTitle icon={<Ionicons name="save-outline" size={16} color={C.accent} />}>
          DATA &amp; BACKUP
        </CardTitle>
        <View style={{ gap: 6 }}>
          <Txt size="sm" color={C.text} weight="700">
            Export Or Restore A Full Backup
          </Txt>
          <Txt size="xs" color={C.dim} weight="500">
            Backups contain every log, meal, workout, habit, food and setting as a single JSON file. Restoring replaces all current data with the contents of the backup file.
          </Txt>
        </View>
        <Divider />
        <Row
          title="Last Backup"
          sub={
            lastBackupAt
              ? new Date(lastBackupAt).toLocaleString()
              : 'Never — export a backup regularly'
          }
        />
        {backupMsg ? (
          <View style={{ backgroundColor: C.surfaceHi, padding: 10, borderRadius: 8 }}>
            <Txt size="xs" color={C.text} weight="600">
              {backupMsg}
            </Txt>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button
              title="Export Backup"
              small
              onPress={handleExportBackup}
              disabled={busyBackup}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Import Backup"
              small
              variant="secondary"
              onPress={() => setRestoreConfirmVisible(true)}
              disabled={busyBackup}
            />
          </View>
        </View>
      </Card>

      {/* Restore Confirmation Modal */}
      <ConfirmModal
        visible={restoreConfirmVisible}
        title="Restore From Backup?"
        message="This will erase all current data and replace it with the contents of the backup file. This cannot be undone."
        confirmText="Restore"
        cancelText="Cancel"
        danger
        onConfirm={() => {
          setRestoreConfirmVisible(false);
          runRestore();
        }}
        onCancel={() => setRestoreConfirmVisible(false)}
      />
    </Screen>
  );
}

const st = StyleSheet.create({
  apiKeyInput: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.text,
    fontSize: 14,
  },
});
