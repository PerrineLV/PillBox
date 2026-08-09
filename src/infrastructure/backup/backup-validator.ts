import {
  deleteDatabaseAsync,
  openDatabaseAsync,
  type SQLiteDatabase,
} from 'expo-sqlite';

import { InvalidBackupError, type PillBoxBackup } from '@/domain/backup/backup';
import { migrateSQLiteDatabase } from '@/infrastructure/database/sqlite-migrations';

import { restoreBackup } from './backup-repository';

export async function validateBackupCanRestore(
  backup: PillBoxBackup,
): Promise<void> {
  const databaseName = `pillbox-validation-${Date.now()}-${Math.random().toString(16).slice(2)}.db`;
  let temporaryDatabase: SQLiteDatabase | null = null;
  try {
    temporaryDatabase = await openDatabaseAsync(databaseName);
    await temporaryDatabase.execAsync('PRAGMA foreign_keys = ON');
    await migrateSQLiteDatabase(temporaryDatabase);
    await restoreBackup(temporaryDatabase, backup, () => Promise.resolve());
    const violations = await temporaryDatabase.getAllAsync(
      'PRAGMA foreign_key_check',
    );
    if (violations.length > 0)
      throw new Error('certaines références entre données sont absentes');
  } catch {
    throw new InvalidBackupError(
      'Les données de la sauvegarde sont incomplètes ou incohérentes. La validation relationnelle a échoué.',
    );
  } finally {
    await temporaryDatabase?.closeAsync();
    await deleteDatabaseAsync(databaseName).catch(() => undefined);
  }
}
