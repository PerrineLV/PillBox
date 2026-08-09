import type { SchemaMigration } from './migration-runner';

export const LATEST_SCHEMA_VERSION = 3;

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
  {
    version: 3,
    name: 'création des boîtes et des mouvements de stock',
    async up(transaction) {
      await transaction.execute(`
        CREATE TABLE medication_boxes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          specialty_cis TEXT NOT NULL,
          specialty_name TEXT NOT NULL,
          pharmaceutical_form TEXT,
          presentation_cip13 TEXT NOT NULL,
          presentation_label TEXT NOT NULL,
          lot TEXT,
          serial_number TEXT,
          expiration_date TEXT NOT NULL CHECK (expiration_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
          initial_quantity INTEGER NOT NULL CHECK (initial_quantity > 0),
          remaining_quantity INTEGER NOT NULL CHECK (remaining_quantity >= 0),
          scan_raw TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE stock_movements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          box_id INTEGER NOT NULL REFERENCES medication_boxes(id) ON DELETE RESTRICT,
          type TEXT NOT NULL CHECK (type IN ('BOX_ADDED', 'MANUAL_ADJUSTMENT', 'CORRECTION')),
          quantity_delta INTEGER NOT NULL,
          quantity_after INTEGER NOT NULL CHECK (quantity_after >= 0),
          explanation TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX medication_boxes_grouping_idx
          ON medication_boxes(specialty_cis, lot, expiration_date);
        CREATE INDEX stock_movements_box_idx
          ON stock_movements(box_id, created_at);
      `);
    },
  },
] satisfies readonly SchemaMigration[];
