import type { SQLiteDatabase } from 'expo-sqlite';

import {
  BACKUP_FORMAT_VERSION,
  type BackupContents,
  type BackupRow,
  type BackupSummary,
  InvalidBackupError,
  MINIMUM_RESTORABLE_SCHEMA_VERSION,
  type PillBoxBackup,
  stableStringify,
  summarizeBackup,
} from '@/domain/backup/backup';
import { LATEST_SCHEMA_VERSION } from '@/infrastructure/database/schema-migrations';

export type Digest = (contents: string) => Promise<string>;

type TableDefinition = Readonly<{ name: string; columns: readonly string[] }>;

const TABLES = [
  {
    name: 'treatments',
    columns: [
      'id',
      'specialty_cis',
      'specialty_name',
      'pharmaceutical_form',
      'active',
      'included_in_pillbox',
      'created_at',
      'updated_at',
      'archived_at',
    ],
  },
  {
    name: 'treatment_dosages',
    columns: ['treatment_id', 'weekday', 'slot', 'quantity_half_units'],
  },
  {
    name: 'treatment_phases',
    columns: [
      'id',
      'treatment_id',
      'position',
      'start_date',
      'end_date',
      'frequency_type',
      'interval_days',
      'anchor_date',
      'weekly_weekday',
    ],
  },
  {
    name: 'treatment_phase_dosages',
    columns: ['phase_id', 'weekday', 'slot', 'quantity_half_units'],
  },
  {
    name: 'medication_boxes',
    // serial_number n'a plus d'usage fonctionnel mais reste sauvegardé tant que
    // la colonne existe, afin qu'aucune donnée déjà enregistrée ne soit perdue.
    columns: [
      'id',
      'specialty_cis',
      'specialty_name',
      'pharmaceutical_form',
      'presentation_cip13',
      'presentation_label',
      'lot',
      'serial_number',
      'expiration_date',
      'initial_quantity',
      'remaining_quantity',
      'source',
      'scan_raw',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'preparations',
    columns: [
      'id',
      'start_date',
      'end_date',
      'status',
      'created_at',
      'completed_at',
    ],
  },
  {
    name: 'preparation_items',
    columns: [
      'id',
      'preparation_id',
      'source_treatment_id',
      'specialty_cis',
      'specialty_name',
      'pharmaceutical_form',
      'intake_date',
      'slot',
      'quantity_half_units',
    ],
  },
  {
    name: 'preparation_requirements',
    columns: [
      'preparation_id',
      'specialty_cis',
      'specialty_name',
      'required_half_units',
      'usable_stock_half_units',
      'missing_half_units',
    ],
  },
  {
    name: 'preparation_progress',
    columns: [
      'preparation_id',
      'specialty_cis',
      'box_id',
      'verification',
      'scan_raw',
      'non_fefo_acknowledged',
      'completed_at',
    ],
  },
  {
    name: 'stock_movements',
    columns: [
      'id',
      'box_id',
      'preparation_id',
      'type',
      'quantity_delta',
      'quantity_after',
      'explanation',
      'created_at',
    ],
  },
  {
    name: 'preparation_box_usages',
    columns: [
      'preparation_id',
      'specialty_cis',
      'specialty_name',
      'box_id',
      'presentation_cip13',
      'presentation_label',
      'lot',
      'serial_number',
      'expiration_date',
      'quantity_half_units',
      'verification',
    ],
  },
  {
    name: 'preparation_reminder_settings',
    columns: [
      'singleton_id',
      'enabled',
      'weekday',
      'hour',
      'minute',
      'notification_id',
      'updated_at',
    ],
  },
  {
    name: 'backup_settings',
    columns: ['singleton_id', 'last_successful_backup_at'],
  },
  {
    name: 'privacy_settings',
    columns: ['singleton_id', 'app_lock_enabled', 'updated_at'],
  },
  {
    name: 'treatment_reminder_settings',
    columns: [
      'treatment_id',
      'enabled',
      'morning_hour',
      'morning_minute',
      'noon_hour',
      'noon_minute',
      'evening_hour',
      'evening_minute',
      'bedtime_hour',
      'bedtime_minute',
      'updated_at',
    ],
  },
  {
    name: 'intake_reminder_slot_settings',
    columns: [
      'singleton_id',
      'morning_hour',
      'morning_minute',
      'noon_hour',
      'noon_minute',
      'evening_hour',
      'evening_minute',
      'bedtime_hour',
      'bedtime_minute',
      'updated_at',
      'enabled',
    ],
  },
  {
    name: 'intake_records',
    columns: [
      'intake_key',
      'source_treatment_id',
      'intake_date',
      'slot',
      'specialty_cis',
      'specialty_name',
      'pharmaceutical_form',
      'quantity_half_units',
      'status',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'intake_postponements',
    columns: [
      'intake_date',
      'slot',
      'scheduled_at',
      'created_at',
      'updated_at',
    ],
  },
] as const satisfies readonly TableDefinition[];

const LEGACY_INTAKE_SLOT_SETTINGS = {
  name: 'intake_reminder_slot_settings',
  columns: [
    'singleton_id',
    'morning_hour',
    'morning_minute',
    'noon_hour',
    'noon_minute',
    'evening_hour',
    'evening_minute',
    'bedtime_hour',
    'bedtime_minute',
    'updated_at',
  ],
} as const satisfies TableDefinition;

/** Colonnes ajoutées par le schéma 16, absentes des sauvegardes antérieures. */
const COLUMNS_ADDED_IN_16: Readonly<Record<string, string>> = {
  medication_boxes: 'source',
  preparation_progress: 'verification',
  preparation_box_usages: 'verification',
};

const SCHEMA_15_TABLES: readonly TableDefinition[] = TABLES.map((table) => {
  const removed = COLUMNS_ADDED_IN_16[table.name];
  return removed === undefined
    ? table
    : {
        name: table.name,
        columns: table.columns.filter((column) => column !== removed),
      };
});
const SCHEMA_14_TABLES = SCHEMA_15_TABLES.map((table) =>
  table.name === 'intake_reminder_slot_settings'
    ? LEGACY_INTAKE_SLOT_SETTINGS
    : table,
);
const SCHEMA_13_TABLES = SCHEMA_14_TABLES.filter(
  (table) =>
    table.name !== 'intake_records' && table.name !== 'intake_postponements',
);
const SCHEMA_12_TABLES = SCHEMA_13_TABLES.filter(
  (table) => table.name !== 'intake_reminder_slot_settings',
);
const SCHEMA_11_TABLES = SCHEMA_12_TABLES.filter(
  (table) => table.name !== 'treatment_reminder_settings',
);
const SCHEMA_10_TABLES = SCHEMA_11_TABLES.filter(
  (table) => table.name !== 'privacy_settings',
);
const SCHEMA_9_TABLES = SCHEMA_10_TABLES.filter(
  (table) => table.name !== 'backup_settings',
);

function tableDefinitions(schemaVersion: number): readonly TableDefinition[] {
  if (schemaVersion === 9) return SCHEMA_9_TABLES;
  if (schemaVersion === 10) return SCHEMA_10_TABLES;
  if (schemaVersion === 11) return SCHEMA_11_TABLES;
  if (schemaVersion === 12) return SCHEMA_12_TABLES;
  if (schemaVersion === 13) return SCHEMA_13_TABLES;
  if (schemaVersion === 14) return SCHEMA_14_TABLES;
  if (schemaVersion === 15) return SCHEMA_15_TABLES;
  return TABLES;
}

export async function createBackup(
  database: SQLiteDatabase,
  createdAt: string,
  digest: Digest,
): Promise<PillBoxBackup> {
  assertIsoDate(createdAt, 'La date de sauvegarde est invalide.');
  const tables: Record<string, readonly BackupRow[]> = {};
  for (const table of TABLES) {
    tables[table.name] = await database.getAllAsync<BackupRow>(
      `SELECT ${table.columns.join(', ')} FROM ${table.name}`,
    );
  }
  const contents: BackupContents = {
    metadata: {
      formatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion: LATEST_SCHEMA_VERSION,
      createdAt,
      application: 'PillBox',
    },
    tables,
  };
  return {
    ...contents,
    integrity: {
      algorithm: 'SHA-256',
      checksum: await digest(stableStringify(contents)),
    },
  };
}

export async function parseAndValidateBackup(
  serialized: string,
  digest: Digest,
): Promise<{ backup: PillBoxBackup; summary: BackupSummary }> {
  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    throw new InvalidBackupError(
      'Ce fichier n’est pas un JSON de sauvegarde PillBox valide.',
    );
  }
  if (
    !isRecord(raw) ||
    !isRecord(raw.metadata) ||
    !isRecord(raw.tables) ||
    !isRecord(raw.integrity)
  ) {
    throw new InvalidBackupError('La sauvegarde est incomplète.');
  }
  const metadata = raw.metadata;
  if (metadata.application !== 'PillBox')
    throw new InvalidBackupError(
      'Ce fichier n’est pas une sauvegarde PillBox.',
    );
  if (metadata.formatVersion !== BACKUP_FORMAT_VERSION)
    throw new InvalidBackupError(
      'La version du format de sauvegarde est incompatible.',
    );
  if (
    typeof metadata.schemaVersion !== 'number' ||
    metadata.schemaVersion > LATEST_SCHEMA_VERSION
  ) {
    throw new InvalidBackupError(
      'Cette sauvegarde provient d’une version plus récente de PillBox. Mettez l’application à jour.',
    );
  }
  if (metadata.schemaVersion < MINIMUM_RESTORABLE_SCHEMA_VERSION)
    throw new InvalidBackupError(
      'Cette sauvegarde est trop ancienne et n’est pas compatible.',
    );
  if (typeof metadata.createdAt !== 'string')
    throw new InvalidBackupError('La date de sauvegarde est absente.');
  assertIsoDate(metadata.createdAt, 'La date de sauvegarde est invalide.');
  if (
    raw.integrity.algorithm !== 'SHA-256' ||
    typeof raw.integrity.checksum !== 'string'
  ) {
    throw new InvalidBackupError(
      'Le contrôle d’intégrité est absent ou incompatible.',
    );
  }
  const definitions = tableDefinitions(metadata.schemaVersion);
  validateTables(raw.tables, definitions);
  const contents: BackupContents = {
    metadata: metadata as BackupContents['metadata'],
    tables: raw.tables as BackupContents['tables'],
  };
  const checksum = await digest(stableStringify(contents));
  if (checksum.toLowerCase() !== raw.integrity.checksum.toLowerCase())
    throw new InvalidBackupError(
      'Le fichier est corrompu ou a été modifié : le contrôle d’intégrité a échoué.',
    );
  const backup = {
    ...contents,
    integrity: raw.integrity as PillBoxBackup['integrity'],
  };
  return { backup, summary: summarizeBackup(backup) };
}

export async function restoreBackup(
  database: SQLiteDatabase,
  backup: PillBoxBackup,
  createSafetyCopy: () => Promise<void>,
): Promise<void> {
  await createSafetyCopy();
  const definitions = tableDefinitions(backup.metadata.schemaVersion);
  await database.withExclusiveTransactionAsync(async (transaction) => {
    for (const table of [...TABLES].reverse())
      await transaction.runAsync(`DELETE FROM ${table.name}`);
    for (const table of definitions) {
      for (const row of backup.tables[table.name]) {
        const placeholders = table.columns.map(() => '?').join(', ');
        await transaction.runAsync(
          `INSERT INTO ${table.name} (${table.columns.join(', ')}) VALUES (${placeholders})`,
          ...table.columns.map((column) => row[column]),
        );
      }
    }
    if (backup.metadata.schemaVersion === 9) {
      await transaction.runAsync(
        'INSERT INTO backup_settings (singleton_id) VALUES (1)',
      );
    }
    if (backup.metadata.schemaVersion <= 10) {
      await transaction.runAsync(
        'INSERT INTO privacy_settings (singleton_id) VALUES (1)',
      );
    }
    if (backup.metadata.schemaVersion <= 12) {
      await transaction.runAsync(
        'INSERT INTO intake_reminder_slot_settings (singleton_id) VALUES (1)',
      );
    }
  });
}

export async function getLastSuccessfulBackupAt(
  database: SQLiteDatabase,
): Promise<string | null> {
  const row = await database.getFirstAsync<{
    last_successful_backup_at: string | null;
  }>(
    'SELECT last_successful_backup_at FROM backup_settings WHERE singleton_id = 1',
  );
  return row?.last_successful_backup_at ?? null;
}

export async function recordSuccessfulBackup(
  database: SQLiteDatabase,
  createdAt: string,
): Promise<void> {
  await database.runAsync(
    'UPDATE backup_settings SET last_successful_backup_at = ? WHERE singleton_id = 1',
    createdAt,
  );
}

function validateTables(
  tables: Record<string, unknown>,
  definitions: readonly TableDefinition[],
): void {
  const expected = definitions.map((table) => table.name).sort();
  if (JSON.stringify(Object.keys(tables).sort()) !== JSON.stringify(expected))
    throw new InvalidBackupError(
      'La liste des données de la sauvegarde est incomplète ou inconnue.',
    );
  for (const table of definitions) {
    const rows = tables[table.name];
    if (!Array.isArray(rows))
      throw new InvalidBackupError(
        `Les données « ${table.name} » sont absentes.`,
      );
    for (const row of rows) {
      if (
        !isRecord(row) ||
        JSON.stringify(Object.keys(row).sort()) !==
          JSON.stringify([...table.columns].sort())
      )
        throw new InvalidBackupError(
          `Une ligne de « ${table.name} » est incomplète ou contient des champs inconnus.`,
        );
      if (
        Object.values(row).some(
          (value) =>
            value !== null &&
            typeof value !== 'string' &&
            (typeof value !== 'number' || !Number.isFinite(value)),
        )
      )
        throw new InvalidBackupError(
          `Une valeur de « ${table.name} » est invalide.`,
        );
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function assertIsoDate(value: string, message: string): void {
  if (!Number.isFinite(Date.parse(value)))
    throw new InvalidBackupError(message);
}
