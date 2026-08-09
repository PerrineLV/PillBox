import type { SQLiteDatabase } from 'expo-sqlite';

import {
  runMigrations,
  type MigrationStore,
  type MigrationTransaction,
} from './migration-runner';
import { LATEST_SCHEMA_VERSION, SCHEMA_MIGRATIONS } from './schema-migrations';

interface SchemaMigrationRow {
  version: number;
}

export async function migrateSQLiteDatabase(
  database: SQLiteDatabase,
): Promise<void> {
  await runMigrations(
    createSQLiteMigrationStore(database),
    SCHEMA_MIGRATIONS,
    LATEST_SCHEMA_VERSION,
  );
}

function createSQLiteMigrationStore(database: SQLiteDatabase): MigrationStore {
  return {
    async runExclusiveTransaction(task) {
      await database.withExclusiveTransactionAsync(
        async (sqliteTransaction) => {
          const transaction: MigrationTransaction = {
            async readAppliedVersions() {
              const migrationTable = await sqliteTransaction.getFirstAsync<{
                name: string;
              }>(
                `SELECT name
                 FROM sqlite_master
                 WHERE type = 'table' AND name = 'schema_migrations'`,
              );

              if (migrationTable === null) {
                return [];
              }

              const rows =
                await sqliteTransaction.getAllAsync<SchemaMigrationRow>(
                  'SELECT version FROM schema_migrations ORDER BY version ASC',
                );
              return rows.map((row) => row.version);
            },
            execute(sql) {
              return sqliteTransaction.execAsync(sql);
            },
            async recordAppliedVersion(version) {
              await sqliteTransaction.runAsync(
                'INSERT INTO schema_migrations (version) VALUES (?)',
                version,
              );
            },
          };

          await task(transaction);
        },
      );
    },
  };
}
