export const BACKUP_FORMAT_VERSION = 1;
export const MINIMUM_RESTORABLE_SCHEMA_VERSION = 9;

export type BackupScalar = string | number | null;
export type BackupRow = Record<string, BackupScalar>;

export interface BackupContents {
  metadata: {
    formatVersion: number;
    schemaVersion: number;
    createdAt: string;
    application: 'PillBox';
  };
  tables: Record<string, readonly BackupRow[]>;
}

export interface PillBoxBackup extends BackupContents {
  integrity: {
    algorithm: 'SHA-256';
    checksum: string;
  };
}

export interface BackupSummary {
  createdAt: string;
  schemaVersion: number;
  treatments: number;
  boxes: number;
  stockMovements: number;
  preparations: number;
}

export class InvalidBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBackupError';
  }
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function summarizeBackup(backup: BackupContents): BackupSummary {
  return {
    createdAt: backup.metadata.createdAt,
    schemaVersion: backup.metadata.schemaVersion,
    treatments: backup.tables.treatments?.length ?? 0,
    boxes: backup.tables.medication_boxes?.length ?? 0,
    stockMovements: backup.tables.stock_movements?.length ?? 0,
    preparations: backup.tables.preparations?.length ?? 0,
  };
}
