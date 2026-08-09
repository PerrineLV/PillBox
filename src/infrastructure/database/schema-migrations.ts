import type { SchemaMigration } from './migration-runner';

export const LATEST_SCHEMA_VERSION = 2;

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
  {
    version: 2,
    name: 'création des traitements et de leurs posologies',
    async up(transaction) {
      await transaction.execute(`
        CREATE TABLE treatments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          specialty_cis TEXT NOT NULL,
          specialty_name TEXT NOT NULL,
          pharmaceutical_form TEXT,
          active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
          included_in_pillbox INTEGER NOT NULL DEFAULT 1 CHECK (included_in_pillbox IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE treatment_dosages (
          treatment_id INTEGER NOT NULL REFERENCES treatments(id) ON DELETE CASCADE,
          weekday TEXT NOT NULL CHECK (weekday IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
          slot TEXT NOT NULL CHECK (slot IN ('morning', 'noon', 'evening', 'bedtime')),
          quantity_half_units INTEGER NOT NULL CHECK (quantity_half_units > 0),
          PRIMARY KEY (treatment_id, weekday, slot)
        );

        CREATE INDEX treatments_specialty_cis_idx ON treatments(specialty_cis);
      `);
    },
  },
] satisfies readonly SchemaMigration[];
