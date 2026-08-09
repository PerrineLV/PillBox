import type { SQLiteDatabase } from 'expo-sqlite';

export async function isAppLockEnabled(
  database: SQLiteDatabase,
): Promise<boolean> {
  const row = await database.getFirstAsync<{ app_lock_enabled: number }>(
    'SELECT app_lock_enabled FROM privacy_settings WHERE singleton_id = 1',
  );
  if (row === null) throw new Error('Réglage de confidentialité introuvable.');
  return row.app_lock_enabled === 1;
}

export async function setAppLockEnabled(
  database: SQLiteDatabase,
  enabled: boolean,
): Promise<void> {
  await database.runAsync(
    `UPDATE privacy_settings
     SET app_lock_enabled = ?, updated_at = CURRENT_TIMESTAMP
     WHERE singleton_id = 1`,
    enabled ? 1 : 0,
  );
}
