import type { SchemaMigration } from './migration-runner';

export const LATEST_SCHEMA_VERSION = 26;

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
  {
    version: 12,
    name: 'ajout des rappels locaux de prise',
    async up(transaction) {
      await transaction.execute(`
        CREATE TABLE treatment_reminder_settings (
          treatment_id INTEGER PRIMARY KEY REFERENCES treatments(id) ON DELETE CASCADE,
          enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
          morning_hour INTEGER, morning_minute INTEGER,
          noon_hour INTEGER, noon_minute INTEGER,
          evening_hour INTEGER, evening_minute INTEGER,
          bedtime_hour INTEGER, bedtime_minute INTEGER,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK ((morning_hour IS NULL) = (morning_minute IS NULL)),
          CHECK ((noon_hour IS NULL) = (noon_minute IS NULL)),
          CHECK ((evening_hour IS NULL) = (evening_minute IS NULL)),
          CHECK ((bedtime_hour IS NULL) = (bedtime_minute IS NULL)),
          CHECK (morning_hour IS NULL OR (morning_hour BETWEEN 0 AND 23 AND morning_minute BETWEEN 0 AND 59)),
          CHECK (noon_hour IS NULL OR (noon_hour BETWEEN 0 AND 23 AND noon_minute BETWEEN 0 AND 59)),
          CHECK (evening_hour IS NULL OR (evening_hour BETWEEN 0 AND 23 AND evening_minute BETWEEN 0 AND 59)),
          CHECK (bedtime_hour IS NULL OR (bedtime_hour BETWEEN 0 AND 23 AND bedtime_minute BETWEEN 0 AND 59))
        );

        CREATE TABLE scheduled_intake_reminders (
          notification_id TEXT PRIMARY KEY NOT NULL,
          scheduled_at TEXT NOT NULL UNIQUE
        );
        CREATE TABLE scheduled_intake_reminder_treatments (
          notification_id TEXT NOT NULL REFERENCES scheduled_intake_reminders(notification_id) ON DELETE CASCADE,
          treatment_id INTEGER NOT NULL REFERENCES treatments(id) ON DELETE CASCADE,
          PRIMARY KEY (notification_id, treatment_id)
        );
      `);
    },
  },
  {
    version: 13,
    name: 'configuration globale des heures de prise',
    async up(transaction) {
      await transaction.execute(`
        CREATE TABLE intake_reminder_slot_settings (
          singleton_id INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (singleton_id = 1),
          morning_hour INTEGER NOT NULL DEFAULT 8 CHECK (morning_hour BETWEEN 0 AND 23),
          morning_minute INTEGER NOT NULL DEFAULT 0 CHECK (morning_minute BETWEEN 0 AND 59),
          noon_hour INTEGER NOT NULL DEFAULT 12 CHECK (noon_hour BETWEEN 0 AND 23),
          noon_minute INTEGER NOT NULL DEFAULT 0 CHECK (noon_minute BETWEEN 0 AND 59),
          evening_hour INTEGER NOT NULL DEFAULT 19 CHECK (evening_hour BETWEEN 0 AND 23),
          evening_minute INTEGER NOT NULL DEFAULT 0 CHECK (evening_minute BETWEEN 0 AND 59),
          bedtime_hour INTEGER NOT NULL DEFAULT 22 CHECK (bedtime_hour BETWEEN 0 AND 23),
          bedtime_minute INTEGER NOT NULL DEFAULT 0 CHECK (bedtime_minute BETWEEN 0 AND 59),
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO intake_reminder_slot_settings (singleton_id) VALUES (1);
        UPDATE treatment_reminder_settings SET enabled = 0;
      `);
    },
  },
  {
    version: 14,
    name: 'suivi et report des prises prévues',
    async up(transaction) {
      await transaction.execute(`
        CREATE TABLE intake_records (
          intake_key TEXT PRIMARY KEY NOT NULL,
          source_treatment_id INTEGER NOT NULL,
          intake_date TEXT NOT NULL CHECK (intake_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
          slot TEXT NOT NULL CHECK (slot IN ('morning', 'noon', 'evening', 'bedtime')),
          specialty_cis TEXT NOT NULL,
          specialty_name TEXT NOT NULL,
          pharmaceutical_form TEXT,
          quantity_half_units INTEGER NOT NULL CHECK (quantity_half_units > 0),
          status TEXT NOT NULL DEFAULT 'UNSET' CHECK (status IN ('UNSET', 'TAKEN', 'SKIPPED')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (source_treatment_id, intake_date, slot)
        );
        CREATE INDEX intake_records_history_idx
          ON intake_records(intake_date DESC, slot, specialty_name);
        CREATE INDEX intake_records_treatment_idx
          ON intake_records(source_treatment_id, intake_date DESC);

        CREATE TABLE intake_postponements (
          intake_date TEXT NOT NULL CHECK (intake_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
          slot TEXT NOT NULL CHECK (slot IN ('morning', 'noon', 'evening', 'bedtime')),
          scheduled_at TEXT NOT NULL,
          notification_id TEXT UNIQUE,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (intake_date, slot)
        );
      `);
    },
  },
  {
    version: 15,
    name: 'activation globale des rappels de prise',
    async up(transaction) {
      await transaction.execute(`
        ALTER TABLE intake_reminder_slot_settings
          ADD COLUMN enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1));
      `);
    },
  },
  {
    version: 16,
    name: 'origine des boîtes et mode de vérification des préparations',
    async up(transaction) {
      // Les lignes existantes proviennent toutes d'un scan : le défaut 'SCAN'
      // décrit exactement l'historique et n'invente aucune donnée.
      // La colonne serial_number est conservée telle quelle pour ne rien
      // détruire, mais elle n'intervient plus dans le comportement de l'app.
      await transaction.execute(`
        ALTER TABLE medication_boxes
          ADD COLUMN source TEXT NOT NULL DEFAULT 'SCAN' CHECK (source IN ('SCAN', 'MANUAL'));
        ALTER TABLE preparation_progress
          ADD COLUMN verification TEXT NOT NULL DEFAULT 'SCAN' CHECK (verification IN ('SCAN', 'MANUAL'));
        ALTER TABLE preparation_box_usages
          ADD COLUMN verification TEXT NOT NULL DEFAULT 'SCAN' CHECK (verification IN ('SCAN', 'MANUAL'));
      `);
    },
  },
  {
    version: 17,
    name: 'cache local de la détection de nouvelle version',
    async up(transaction) {
      // Ces colonnes ne contiennent aucune donnée de santé : uniquement la
      // dernière release publique connue et le report choisi par l'utilisatrice.
      // Cache propre à l'installation, volontairement absent des sauvegardes du
      // ticket 11b : une restauration ne doit pas masquer une mise à jour.
      await transaction.execute(`
        CREATE TABLE update_check_settings (
          singleton_id INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (singleton_id = 1),
          last_checked_at TEXT,
          latest_version TEXT,
          latest_release_url TEXT,
          latest_apk_url TEXT,
          postponed_version TEXT,
          postponed_at TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO update_check_settings (singleton_id) VALUES (1);
      `);
    },
  },
  {
    version: 18,
    name: 'pont de compatibilité — table de renouvellement retirée',
    async up(transaction) {
      // Le ticket 15 a exploré puis abandonné un masquage temporaire des
      // alertes de renouvellement, appuyé sur cette table. Cette migration ne
      // sert plus qu'à rester compatible avec les bases locales de test qui
      // l'avaient déjà appliquée avant l'abandon : elle ne crée aucune
      // fonctionnalité et aucun code ne lit ou n'écrit dans cette table.
      await transaction.execute(`
        CREATE TABLE medication_renewal_dismissals (
          specialty_cis TEXT PRIMARY KEY NOT NULL,
          available_half_units_snapshot INTEGER NOT NULL,
          urgency_snapshot TEXT NOT NULL,
          dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    },
  },
  {
    version: 19,
    name: 'suppression de la table de renouvellement inutilisée',
    async up(transaction) {
      // La migration 18 créait cette table pour un masquage temporaire des
      // alertes de renouvellement, abandonné avant toute écriture en dehors
      // des bases de test locales. Elle est vide sur toute installation
      // réelle : la supprimer ne perd aucune donnée.
      await transaction.execute(`
        DROP TABLE medication_renewal_dismissals;
      `);
    },
  },
  {
    version: 20,
    name: 'traitements si besoin et prises ponctuelles',
    async up(transaction) {
      // Les lignes existantes sont toutes des traitements planifiés : le
      // défaut 'SCHEDULED' décrit exactement l'historique et n'invente rien.
      // Un traitement « si besoin » n'a jamais de phase et n'est jamais inclus
      // dans le pilulier (ticket 19) : ces informations restent purement
      // déclaratives, jamais utilisées pour calculer un délai avant reprise.
      await transaction.execute(`
        ALTER TABLE treatments
          ADD COLUMN dosage_kind TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (dosage_kind IN ('SCHEDULED', 'AS_NEEDED'));
        ALTER TABLE treatments
          ADD COLUMN as_needed_max_quantity_half_units INTEGER
            CHECK (as_needed_max_quantity_half_units IS NULL OR as_needed_max_quantity_half_units > 0);
        ALTER TABLE treatments
          ADD COLUMN as_needed_min_interval_hours INTEGER
            CHECK (as_needed_min_interval_hours IS NULL OR as_needed_min_interval_hours > 0);

        CREATE TABLE as_needed_intake_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          treatment_id INTEGER NOT NULL REFERENCES treatments(id) ON DELETE CASCADE,
          taken_at TEXT NOT NULL,
          quantity_half_units INTEGER NOT NULL CHECK (quantity_half_units > 0),
          note TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX as_needed_intake_records_treatment_idx
          ON as_needed_intake_records(treatment_id, taken_at DESC);
      `);
    },
  },
  {
    version: 21,
    name: 'plusieurs boîtes pour un même médicament au sein d’une préparation',
    async up(transaction) {
      // Jusqu'ici une préparation ne retenait qu'une seule boîte par
      // médicament, même lorsque celle-ci ne suffisait pas pour toute la
      // semaine. Chaque ligne existante couvrait donc, par construction,
      // l'intégralité du besoin de sa spécialité : la quantité est
      // reconstituée depuis preparation_requirements, sans rien inventer.
      await transaction.execute(`
        DROP INDEX preparation_progress_preparation_idx;
        ALTER TABLE preparation_progress RENAME TO preparation_progress_v20;

        CREATE TABLE preparation_progress (
          preparation_id INTEGER NOT NULL REFERENCES preparations(id) ON DELETE RESTRICT,
          specialty_cis TEXT NOT NULL,
          box_id INTEGER NOT NULL REFERENCES medication_boxes(id) ON DELETE RESTRICT,
          quantity_half_units INTEGER NOT NULL CHECK (quantity_half_units > 0),
          verification TEXT NOT NULL CHECK (verification IN ('SCAN', 'MANUAL')),
          scan_raw TEXT NOT NULL DEFAULT '',
          non_fefo_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (non_fefo_acknowledged IN (0, 1)),
          completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (preparation_id, specialty_cis, box_id),
          FOREIGN KEY (preparation_id, specialty_cis)
            REFERENCES preparation_requirements(preparation_id, specialty_cis)
            ON DELETE RESTRICT
        );

        INSERT INTO preparation_progress
          (preparation_id, specialty_cis, box_id, quantity_half_units,
           verification, scan_raw, non_fefo_acknowledged, completed_at)
        SELECT
          old.preparation_id, old.specialty_cis, old.box_id,
          requirement.required_half_units, old.verification, old.scan_raw,
          old.non_fefo_acknowledged, old.completed_at
        FROM preparation_progress_v20 old
        JOIN preparation_requirements requirement
          ON requirement.preparation_id = old.preparation_id
         AND requirement.specialty_cis = old.specialty_cis;

        DROP TABLE preparation_progress_v20;

        CREATE INDEX preparation_progress_preparation_idx
          ON preparation_progress(preparation_id);

        DROP INDEX preparation_box_usages_preparation_idx;
        ALTER TABLE preparation_box_usages RENAME TO preparation_box_usages_v20;

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
          verification TEXT NOT NULL DEFAULT 'SCAN' CHECK (verification IN ('SCAN', 'MANUAL')),
          PRIMARY KEY (preparation_id, specialty_cis, box_id)
        );

        INSERT INTO preparation_box_usages
          (preparation_id, specialty_cis, specialty_name, box_id,
           presentation_cip13, presentation_label, lot, serial_number,
           expiration_date, quantity_half_units, verification)
        SELECT preparation_id, specialty_cis, specialty_name, box_id,
          presentation_cip13, presentation_label, lot, serial_number,
          expiration_date, quantity_half_units, verification
        FROM preparation_box_usages_v20;

        DROP TABLE preparation_box_usages_v20;

        CREATE INDEX preparation_box_usages_preparation_idx
          ON preparation_box_usages(preparation_id);
      `);
    },
  },
  {
    version: 22,
    name: 'historique du cycle de vie des traitements pour la timeline',
    async up(transaction) {
      // Jusqu'ici, seul le dernier archivage était connu (colonne archived_at) :
      // une réactivation n'était pas datée et une modification de posologie
      // écrasait silencieusement les anciennes phases. Cette table journalise
      // ces événements pour toute modification future, sans jamais inventer
      // ceux du passé qui n'ont pas été enregistrés.
      await transaction.execute(`
        CREATE TABLE treatment_lifecycle_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          treatment_id INTEGER NOT NULL REFERENCES treatments(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL CHECK (event_type IN ('ARCHIVED', 'REACTIVATED', 'DOSAGE_MODIFIED')),
          occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX treatment_lifecycle_events_treatment_idx
          ON treatment_lifecycle_events(treatment_id, occurred_at);

        INSERT INTO treatment_lifecycle_events (treatment_id, event_type, occurred_at)
        SELECT id, 'ARCHIVED', archived_at FROM treatments WHERE archived_at IS NOT NULL;
      `);
    },
  },
  {
    version: 23,
    name: 'équivalence générique confirmée lors de la vérification d’une boîte',
    async up(transaction) {
      // Mémorisation par couple (traitement, CIS précis) : une fois confirmée,
      // une correspondance générique n'est plus redemandée pour ce couple. Le
      // libellé du groupe et le nom de la spécialité sont dupliqués ici (comme
      // déjà pour medication_boxes.specialty_name) pour ne pas dépendre d'une
      // seconde connexion vers le référentiel BDPM en dehors du moment de la
      // vérification. Aucune ligne existante n'est retouchée : cette table
      // démarre vide, il n'y a pas d'équivalence passée à reconstituer.
      // Les nouvelles colonnes matched_cis/matched_specialty_name restent NULL
      // pour toute ligne déjà enregistrée, ce qui décrit exactement l'existant
      // : jusqu'ici, une boîte retenue avait toujours le CIS strictement
      // attendu, jamais un équivalent générique.
      await transaction.execute(`
        CREATE TABLE generic_equivalence_confirmations (
          treatment_id INTEGER NOT NULL REFERENCES treatments(id) ON DELETE CASCADE,
          cis TEXT NOT NULL CHECK (length(cis) = 8),
          specialty_name TEXT NOT NULL,
          group_label TEXT NOT NULL,
          confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (treatment_id, cis)
        );

        ALTER TABLE preparation_progress ADD COLUMN matched_cis TEXT;
        ALTER TABLE preparation_progress ADD COLUMN matched_specialty_name TEXT;
        ALTER TABLE preparation_box_usages ADD COLUMN matched_cis TEXT;
        ALTER TABLE preparation_box_usages ADD COLUMN matched_specialty_name TEXT;
      `);
    },
  },
  {
    version: 24,
    name: 'suivi informatif des délivrances encadrées (stupéfiants)',
    async up(transaction) {
      // Purement informatif (ticket 30) : ne conditionne aucun calcul de
      // couverture ou d'urgence. Toutes les colonnes restent NULL pour les
      // traitements existants, qu'ils soient ou non concernés par une
      // délivrance encadrée — cette information n'existait pas avant ce
      // ticket et n'est jamais déduite rétroactivement.
      await transaction.execute(`
        ALTER TABLE treatments
          ADD COLUMN controlled_dispensing_enabled INTEGER
            CHECK (controlled_dispensing_enabled IS NULL OR controlled_dispensing_enabled IN (0, 1));
        ALTER TABLE treatments
          ADD COLUMN controlled_dispensing_periodicity_days INTEGER
            CHECK (controlled_dispensing_periodicity_days IS NULL OR controlled_dispensing_periodicity_days > 0);
        ALTER TABLE treatments
          ADD COLUMN controlled_dispensing_last_dispensed_at TEXT;
        ALTER TABLE treatments
          ADD COLUMN controlled_dispensing_theoretical_renewal_date TEXT;
      `);
    },
  },
  {
    version: 25,
    name: 'état « en attente de complément » pour la délivrance encadrée',
    async up(transaction) {
      // Purement un suivi post-validation (ticket 30b) : NULL pour toute
      // case existante (préparations déjà validées avant ce ticket, sous
      // l'ancienne règle qui exigeait une couverture exacte — donc jamais
      // réellement en attente) et pour toute case d'un traitement sans
      // délivrance encadrée, qui continue de suivre le comportement existant
      // (couverture exacte obligatoire, alerte de stock bas du ticket 11).
      await transaction.execute(`
        ALTER TABLE preparation_items
          ADD COLUMN completion_status TEXT
            CHECK (completion_status IS NULL OR completion_status IN ('FILLED', 'PENDING_COMPLEMENT'));

        CREATE TABLE pending_completion_reminders (
          preparation_id INTEGER NOT NULL REFERENCES preparations(id) ON DELETE CASCADE,
          specialty_cis TEXT NOT NULL,
          notification_id TEXT NOT NULL,
          scheduled_at TEXT NOT NULL,
          PRIMARY KEY (preparation_id, specialty_cis)
        );
      `);
    },
  },
  {
    version: 26,
    name: 'ordonnances et lignes d’ordonnance (ticket 45)',
    async up(transaction) {
      // La cadence de délivrance (complète ou fractionnée) devient une
      // propriété de la ligne d'ordonnance plutôt que du traitement : un même
      // traitement peut être couvert par plusieurs ordonnances successives,
      // avec des modes de délivrance différents d'une ordonnance à l'autre.
      // Réutilisable pour tout traitement, plus seulement les stupéfiants
      // détectés par la BDPM.
      await transaction.execute(`
        CREATE TABLE prescriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          label TEXT NOT NULL,
          issue_date TEXT NOT NULL CHECK (issue_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
          valid_until TEXT NOT NULL CHECK (valid_until GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE prescription_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          prescription_id INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
          treatment_id INTEGER NOT NULL REFERENCES treatments(id) ON DELETE CASCADE,
          quantity_kind TEXT NOT NULL CHECK (quantity_kind IN ('DURATION', 'BOX_COUNT')),
          duration_days INTEGER CHECK (duration_days IS NULL OR duration_days > 0),
          box_count INTEGER CHECK (box_count IS NULL OR box_count > 0),
          dispensing_mode TEXT NOT NULL CHECK (dispensing_mode IN ('FULL', 'FRACTIONAL')),
          periodicity_days INTEGER CHECK (periodicity_days IS NULL OR periodicity_days > 0),
          last_dispensed_at TEXT,
          theoretical_renewal_date TEXT,
          tolerance_days INTEGER CHECK (tolerance_days IS NULL OR tolerance_days >= 0),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK (
            (quantity_kind = 'DURATION' AND duration_days IS NOT NULL AND box_count IS NULL) OR
            (quantity_kind = 'BOX_COUNT' AND box_count IS NOT NULL AND duration_days IS NULL)
          ),
          CHECK (
            (dispensing_mode = 'FULL' AND periodicity_days IS NULL AND last_dispensed_at IS NULL
              AND theoretical_renewal_date IS NULL AND tolerance_days IS NULL) OR
            (dispensing_mode = 'FRACTIONAL' AND periodicity_days IS NOT NULL)
          )
        );

        CREATE INDEX prescription_items_prescription_idx
          ON prescription_items(prescription_id);
        CREATE INDEX prescription_items_treatment_idx
          ON prescription_items(treatment_id);

        -- Préserve l'information des traitements déjà suivis en délivrance
        -- encadrée (ticket 30, en production) sous forme d'une ordonnance de
        -- secours par traitement concerné, plutôt que de la perdre : seuls
        -- les traitements où l'indicateur était explicitement activé (1, pas
        -- seulement détecté) sont concernés, à l'identique du comportement
        -- précédent (buildTheoreticalRenewalDateIndex et la validation
        -- partielle du ticket 30b ignoraient déjà un indicateur décoché).
        -- Le libellé intègre l'id du traitement pour permettre de
        -- recorréler chaque ordonnance de secours à son traitement d'origine
        -- par une jointure exacte, sans dépendre de l'ordre d'insertion ni
        -- d'un identifiant technique renvoyé par le moteur.
        INSERT INTO prescriptions (label, issue_date, valid_until)
        SELECT
          'Ordonnance existante (migration délivrance encadrée, traitement #' || t.id || ')',
          COALESCE(t.controlled_dispensing_last_dispensed_at, date('now')),
          date(COALESCE(t.controlled_dispensing_last_dispensed_at, date('now')), '+1 year')
        FROM treatments t
        WHERE t.controlled_dispensing_enabled = 1;

        INSERT INTO prescription_items
          (prescription_id, treatment_id, quantity_kind, duration_days, box_count,
           dispensing_mode, periodicity_days, last_dispensed_at,
           theoretical_renewal_date, tolerance_days)
        SELECT
          p.id, t.id, 'DURATION', t.controlled_dispensing_periodicity_days, NULL,
          'FRACTIONAL', t.controlled_dispensing_periodicity_days,
          t.controlled_dispensing_last_dispensed_at,
          t.controlled_dispensing_theoretical_renewal_date, NULL
        FROM treatments t
        JOIN prescriptions p
          ON p.label = 'Ordonnance existante (migration délivrance encadrée, traitement #' || t.id || ')'
        WHERE t.controlled_dispensing_enabled = 1;
      `);
      // Les 4 colonnes controlled_dispensing_* de `treatments` (ticket 30)
      // sont volontairement laissées en place plutôt que supprimées :
      // `treatments` est référencé par de nombreuses tables via clé
      // étrangère (treatment_phases, treatment_lifecycle_events,
      // generic_equivalence_confirmations, l'orpheline treatment_dosages
      // déjà laissée en l'état depuis la migration 4, etc.) et SQLite
      // réécrit silencieusement ces références vers l'ancien nom lors d'un
      // ALTER TABLE ... RENAME, ce qui casserait ces tables si l'ancienne
      // copie de `treatments` était ensuite supprimée sans reconstruire
      // aussi chacune d'elles dans la même migration. Un risque disproportionné
      // pour la suppression de 4 colonnes désormais mortes : ni lues ni
      // écrites par aucun code applicatif à partir de ce ticket, leur
      // information vivante a été reprise ci-dessus par `prescription_items`.
    },
  },
] satisfies readonly SchemaMigration[];
