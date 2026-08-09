import type { SchemaMigration } from './migration-runner';

export const LATEST_SCHEMA_VERSION = 1;

export const SCHEMA_MIGRATIONS = [
  {
    version: 1,
    name: 'création de l’historique des migrations',
    async up(transaction) {
      await transaction.execute(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY NOT NULL,
          applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    },
  },
] satisfies readonly SchemaMigration[];
