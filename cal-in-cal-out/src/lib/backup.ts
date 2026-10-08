import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase, SQLiteBindValue } from 'expo-sqlite';
// The new File API is native-only; on web we use browser Blob/File APIs directly.
import { File, Paths } from 'expo-file-system';

const BACKUP_APP_ID = 'cal-in-cal-backup';
const BACKUP_VERSION = 1;

// Ordered for foreign-key safety: parents before children on insert.
const BACKUP_TABLES = [
  'daily_logs',
  'meal_entries',
  'expenditure_history',
  'custom_foods',
  'settings',
  'workout_entries',
  'workout_templates',
  'user_goals',
  'supplements',
  'supplement_logs',
  'exercises',
  'routines',
  'routine_exercises',
  'habits',
  'habit_logs',
] as const;

export interface BackupData {
  app: string;
  version: number;
  created_at: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export async function createBackup(db: SQLiteDatabase): Promise<BackupData> {
  const tables: BackupData['tables'] = {};
  for (const t of BACKUP_TABLES) {
    tables[t] = await db.getAllAsync<Record<string, unknown>>(`SELECT * FROM ${t}`);
  }
  return {
    app: BACKUP_APP_ID,
    version: BACKUP_VERSION,
    created_at: new Date().toISOString(),
    tables,
  };
}

export function parseBackup(text: string): BackupData {
  let data: BackupData;
  try {
    data = JSON.parse(text) as BackupData;
  } catch {
    throw new Error('File could not be read as JSON. Make sure you picked a backup file.');
  }
  if (!data || data.app !== BACKUP_APP_ID || !data.tables) {
    throw new Error('This file is not a valid Cal In Cal Out backup.');
  }
  return data;
}

export async function restoreBackup(db: SQLiteDatabase, data: BackupData): Promise<void> {
  await db.withExclusiveTransactionAsync(async (txn) => {
    // Delete children first so foreign-key cascades do not interfere
    for (const t of [
      'habit_logs',
      'habits',
      'supplement_logs',
      'supplements',
      'routine_exercises',
      'routines',
      'exercises',
      'meal_entries',
      'daily_logs',
      'expenditure_history',
      'custom_foods',
      'settings',
      'workout_entries',
      'workout_templates',
      'user_goals',
    ]) {
      await txn.execAsync(`DELETE FROM ${t}`);
    }

    for (const t of BACKUP_TABLES) {
      const rows = data.tables[t] ?? [];
      for (const row of rows) {
        const keys = Object.keys(row);
        if (keys.length === 0) continue;
        const cols = keys.map((k) => `"${k}"`).join(', ');
        const placeholders = keys.map(() => '?').join(', ');
        const values = keys.map(
          (k) => (row as Record<string, unknown>)[k] as SQLiteBindValue,
        );
        await txn.runAsync(`INSERT INTO ${t} (${cols}) VALUES (${placeholders})`, values);
      }
    }
  });
}

export function backupFileName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `cal-in-cal-out-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

/** Writes the JSON to a downloadable file (web) or shares it (native). */
export async function saveBackupFile(json: string, fileName: string): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke late — revoking immediately can abort the download in some browsers
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    return;
  }

  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(json);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json' });
  }
}

/** Opens a file picker and returns the selected file's text content, or null if cancelled. */
export async function pickBackupFileText(): Promise<string | null> {
  if (Platform.OS === 'web') {
    // Create the input in the same synchronous user-gesture task so the
    // browser does not reject the picker for lacking user activation.
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.onchange = async () => {
        const file = input.files && input.files.length > 0 ? input.files[0] : null;
        if (!file) {
          resolve(null);
          return;
        }
        try {
          resolve(await file.text());
        } catch {
          resolve(null);
        }
      };
      input.click();
    });
  }

  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets || result.assets.length === 0) return null;
  const asset = result.assets[0];
  const file = new File(asset.uri);
  return file.text();
}
