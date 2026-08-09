import type { SchemaMigration } from './migration-runner';

export const LATEST_SCHEMA_VERSION = 11;

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
  {
    version: 4,
    name: 'ajout des phases et fréquences de traitement',
    async up(transaction) {
      await transaction.execute(`
        CREATE TABLE treatment_phases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          treatment_id INTEGER NOT NULL REFERENCES treatments(id) ON DELETE CASCADE,
          position INTEGER NOT NULL CHECK (position >= 0),
          start_date TEXT,
          end_date TEXT,
          frequency_type TEXT NOT NULL CHECK (frequency_type IN ('daily', 'interval', 'weekly', 'legacy_weekdays')),
          interval_days INTEGER,
          anchor_date TEXT,
          weekly_weekday TEXT,
          CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
          CHECK (
            (frequency_type = 'daily' AND start_date IS NOT NULL AND interval_days IS NULL AND anchor_date IS NULL AND weekly_weekday IS NULL) OR
            (frequency_type = 'interval' AND start_date IS NOT NULL AND interval_days >= 2 AND anchor_date IS NOT NULL AND weekly_weekday IS NULL) OR
            (frequency_type = 'weekly' AND start_date IS NOT NULL AND interval_days IS NULL AND anchor_date IS NULL AND weekly_weekday IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')) OR
            (frequency_type = 'legacy_weekdays' AND start_date IS NULL AND end_date IS NULL AND interval_days IS NULL AND anchor_date IS NULL AND weekly_weekday IS NULL)
          ),
          UNIQUE (treatment_id, position)
        );

        CREATE TABLE treatment_phase_dosages (
          phase_id INTEGER NOT NULL REFERENCES treatment_phases(id) ON DELETE CASCADE,
          weekday TEXT NOT NULL DEFAULT '' CHECK (weekday IN ('', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
          slot TEXT NOT NULL CHECK (slot IN ('morning', 'noon', 'evening', 'bedtime')),
          quantity_half_units INTEGER NOT NULL CHECK (quantity_half_units > 0),
          PRIMARY KEY (phase_id, weekday, slot)
        );

        INSERT INTO treatment_phases (treatment_id, position, frequency_type)
        SELECT DISTINCT treatment_id, 0, 'legacy_weekdays'
        FROM treatment_dosages;

        INSERT INTO treatment_phase_dosages (phase_id, weekday, slot, quantity_half_units)
        SELECT phase.id, dosage.weekday, dosage.slot, dosage.quantity_half_units
        FROM treatment_dosages dosage
        JOIN treatment_phases phase ON phase.treatment_id = dosage.treatment_id
        WHERE phase.frequency_type = 'legacy_weekdays';

        CREATE INDEX treatment_phases_treatment_idx
          ON treatment_phases(treatment_id, position);
      `);
    },
  },
  {
    version: 5,
    name: 'création des snapshots de préparation',
    async up(transaction) {
      await transaction.execute(`
        CREATE TABLE preparations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK (end_date >= start_date)
        );

        CREATE TABLE preparation_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          preparation_id INTEGER NOT NULL REFERENCES preparations(id) ON DELETE RESTRICT,
          source_treatment_id INTEGER NOT NULL,
          specialty_cis TEXT NOT NULL,
          specialty_name TEXT NOT NULL,
          pharmaceutical_form TEXT,
          intake_date TEXT NOT NULL,
          slot TEXT NOT NULL CHECK (slot IN ('morning', 'noon', 'evening', 'bedtime')),
          quantity_half_units INTEGER NOT NULL CHECK (quantity_half_units > 0)
        );

        CREATE TABLE preparation_requirements (
          preparation_id INTEGER NOT NULL REFERENCES preparations(id) ON DELETE RESTRICT,
          specialty_cis TEXT NOT NULL,
          specialty_name TEXT NOT NULL,
          required_half_units INTEGER NOT NULL CHECK (required_half_units > 0),
          usable_stock_half_units INTEGER NOT NULL CHECK (usable_stock_half_units >= 0),
          missing_half_units INTEGER NOT NULL CHECK (missing_half_units >= 0),
          PRIMARY KEY (preparation_id, specialty_cis)
        );

        CREATE INDEX preparation_items_preparation_idx
          ON preparation_items(preparation_id, intake_date, slot);
      `);
    },
  },
  {
    version: 6,
    name: 'ajout de la progression de préparation',
    async up(transaction) {
      await transaction.execute(`
        CREATE TABLE preparation_progress (
          preparation_id INTEGER NOT NULL REFERENCES preparations(id) ON DELETE RESTRICT,
          specialty_cis TEXT NOT NULL,
          box_id INTEGER NOT NULL REFERENCES medication_boxes(id) ON DELETE RESTRICT,
          scan_raw TEXT NOT NULL,
          non_fefo_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (non_fefo_acknowledged IN (0, 1)),
          completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (preparation_id, specialty_cis),
          FOREIGN KEY (preparation_id, specialty_cis)
            REFERENCES preparation_requirements(preparation_id, specialty_cis)
            ON DELETE RESTRICT
        );

        CREATE INDEX preparation_progress_preparation_idx
          ON preparation_progress(preparation_id);
      `);
    },
  },
  {
    version: 7,
    name: 'validation finale et historique des préparations',
    async up(transaction) {
      await transaction.execute(`
        ALTER TABLE preparation_progress RENAME TO preparation_progress_v6;
        ALTER TABLE preparation_requirements RENAME TO preparation_requirements_v6;
        ALTER TABLE preparation_items RENAME TO preparation_items_v6;
        ALTER TABLE preparations RENAME TO preparations_v6;

        CREATE TABLE preparations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'COMPLETED')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at TEXT,
          CHECK (end_date >= start_date),
          CHECK ((status = 'DRAFT' AND completed_at IS NULL) OR
                 (status = 'COMPLETED' AND completed_at IS NOT NULL))
        );

        CREATE TABLE preparation_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          preparation_id INTEGER NOT NULL REFERENCES preparations(id) ON DELETE RESTRICT,
          source_treatment_id INTEGER NOT NULL,
          specialty_cis TEXT NOT NULL,
          specialty_name TEXT NOT NULL,
          pharmaceutical_form TEXT,
          intake_date TEXT NOT NULL,
          slot TEXT NOT NULL CHECK (slot IN ('morning', 'noon', 'evening', 'bedtime')),
          quantity_half_units INTEGER NOT NULL CHECK (quantity_half_units > 0)
        );

        CREATE TABLE preparation_requirements (
          preparation_id INTEGER NOT NULL REFERENCES preparations(id) ON DELETE RESTRICT,
          specialty_cis TEXT NOT NULL,
          specialty_name TEXT NOT NULL,
          required_half_units INTEGER NOT NULL CHECK (required_half_units > 0),
          usable_stock_half_units INTEGER NOT NULL CHECK (usable_stock_half_units >= 0),
          missing_half_units INTEGER NOT NULL CHECK (missing_half_units >= 0),
          PRIMARY KEY (preparation_id, specialty_cis)
        );

        CREATE TABLE preparation_progress (
          preparation_id INTEGER NOT NULL REFERENCES preparations(id) ON DELETE RESTRICT,
          specialty_cis TEXT NOT NULL,
          box_id INTEGER NOT NULL REFERENCES medication_boxes(id) ON DELETE RESTRICT,
          scan_raw TEXT NOT NULL,
          non_fefo_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (non_fefo_acknowledged IN (0, 1)),
          completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (preparation_id, specialty_cis),
          FOREIGN KEY (preparation_id, specialty_cis)
            REFERENCES preparation_requirements(preparation_id, specialty_cis)
            ON DELETE RESTRICT
        );

        INSERT INTO preparations (id, start_date, end_date, status, created_at)
        SELECT id, start_date, end_date, status, created_at FROM preparations_v6;
        INSERT INTO preparation_items SELECT * FROM preparation_items_v6;
        INSERT INTO preparation_requirements SELECT * FROM preparation_requirements_v6;
        INSERT INTO preparation_progress SELECT * FROM preparation_progress_v6;

        DROP TABLE preparation_progress_v6;
        DROP TABLE preparation_requirements_v6;
        DROP TABLE preparation_items_v6;
        DROP TABLE preparations_v6;

        DROP INDEX stock_movements_box_idx;
        ALTER TABLE stock_movements RENAME TO stock_movements_v6;
        CREATE TABLE stock_movements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          box_id INTEGER NOT NULL REFERENCES medication_boxes(id) ON DELETE RESTRICT,
          preparation_id INTEGER REFERENCES preparations(id) ON DELETE RESTRICT,
          type TEXT NOT NULL CHECK (type IN ('BOX_ADDED', 'MANUAL_ADJUSTMENT', 'CORRECTION', 'PILLBOX_PREPARATION')),
          quantity_delta REAL NOT NULL,
          quantity_after REAL NOT NULL CHECK (quantity_after >= 0),
          explanation TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK ((type = 'PILLBOX_PREPARATION' AND preparation_id IS NOT NULL) OR
                 (type <> 'PILLBOX_PREPARATION' AND preparation_id IS NULL))
        );
        INSERT INTO stock_movements
          (id, box_id, type, quantity_delta, quantity_after, explanation, created_at)
        SELECT id, box_id, type, quantity_delta, quantity_after, explanation, created_at
        FROM stock_movements_v6;
        DROP TABLE stock_movements_v6;

        CREATE TABLE preparation_box_usages (
          preparation_id INTEGER NOT NULL REFERENCES preparations(id) ON DELETE RESTRICT,
          specialty_cis TEXT NOT NULL,
          specialty_name TEXT NOT NULL,
          box_id INTEGER NOT NULL REFERENCES medication_boxes(id) ON DELETE RESTRICT,
          presentation_cip13 TEXT NOT NULL,
          presentation_label TEXT NOT NULL,
          lot TEXT,
          serial_number TEXT,
          expiration_date TEXT NOT NULL,
          quantity_half_units INTEGER NOT NULL CHECK (quantity_half_units > 0),
          PRIMARY KEY (preparation_id, specialty_cis)
        );

        CREATE INDEX preparation_items_preparation_idx
          ON preparation_items(preparation_id, intake_date, slot);
        CREATE INDEX preparation_progress_preparation_idx
          ON preparation_progress(preparation_id);
        CREATE INDEX stock_movements_box_idx
          ON stock_movements(box_id, created_at);
        CREATE INDEX stock_movements_preparation_idx
          ON stock_movements(preparation_id);
        CREATE INDEX preparation_box_usages_preparation_idx
          ON preparation_box_usages(preparation_id);
      `);
    },
  },
  {
    version: 8,
    name: 'création du réglage du rappel de préparation',
    async up(transaction) {
      await transaction.execute(`
        CREATE TABLE preparation_reminder_settings (
          singleton_id INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (singleton_id = 1),
          enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
          weekday TEXT NOT NULL DEFAULT 'sunday' CHECK (weekday IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
          hour INTEGER NOT NULL DEFAULT 18 CHECK (hour BETWEEN 0 AND 23),
          minute INTEGER NOT NULL DEFAULT 0 CHECK (minute BETWEEN 0 AND 59),
          notification_id TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK ((enabled = 1 AND notification_id IS NOT NULL) OR
                 (enabled = 0 AND notification_id IS NULL))
        );

        INSERT INTO preparation_reminder_settings (singleton_id) VALUES (1);
      `);
    },
  },
  {
    version: 9,
    name: 'ajout de l’archivage explicite des traitements',
    async up(transaction) {
      await transaction.execute(`
        ALTER TABLE treatments ADD COLUMN archived_at TEXT;
        CREATE INDEX treatments_archived_at_idx ON treatments(archived_at);
      `);
    },
  },
  {
    version: 10,
    name: 'ajout du suivi des sauvegardes locales',
    async up(transaction) {
      await transaction.execute(`
        CREATE TABLE backup_settings (
          singleton_id INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (singleton_id = 1),
          last_successful_backup_at TEXT
        );

        INSERT INTO backup_settings (singleton_id) VALUES (1);
      `);
    },
  },
  {
    version: 11,
    name: 'ajout des réglages de confidentialité locale',
    async up(transaction) {
      await transaction.execute(`
        CREATE TABLE privacy_settings (
          singleton_id INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (singleton_id = 1),
          app_lock_enabled INTEGER NOT NULL DEFAULT 0 CHECK (app_lock_enabled IN (0, 1)),
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO privacy_settings (singleton_id) VALUES (1);
      `);
    },
  },
] satisfies readonly SchemaMigration[];
