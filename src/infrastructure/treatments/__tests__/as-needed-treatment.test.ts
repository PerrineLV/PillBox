import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { TreatmentDraft } from '@/domain/treatments/treatment';
import { SCHEMA_MIGRATIONS } from '@/infrastructure/database/schema-migrations';
import {
  createTreatment,
  getTreatment,
  getTreatmentRemovalAction,
  updateTreatment,
} from '../treatment-repository';

type Parameters = readonly (string | number | null)[];
type TestDatabase = {
  getFirstAsync<T>(sql: string, ...parameters: Parameters): Promise<T | null>;
  getAllAsync<T>(sql: string, ...parameters: Parameters): Promise<T[]>;
  runAsync(
    sql: string,
    ...parameters: Parameters
  ): Promise<{ changes: number; lastInsertRowId: number }>;
  withExclusiveTransactionAsync(
    task: (transaction: TestDatabase) => Promise<void>,
  ): Promise<void>;
};

function adapter(raw: Database.Database): SQLiteDatabase {
  const database: TestDatabase = {
    async getFirstAsync<T>(sql: string, ...parameters: Parameters) {
      return (raw.prepare(sql).get(...parameters) as T | undefined) ?? null;
    },
    async getAllAsync<T>(sql: string, ...parameters: Parameters) {
      return raw.prepare(sql).all(...parameters) as T[];
    },
    async runAsync(sql: string, ...parameters: Parameters) {
      const result = raw.prepare(sql).run(...parameters);
      return {
        changes: result.changes,
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },
    async withExclusiveTransactionAsync(task) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        await task(database);
        raw.exec('COMMIT');
      } catch (error: unknown) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return database as unknown as SQLiteDatabase;
}

async function setup() {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  for (const migration of SCHEMA_MIGRATIONS) {
    await migration.up({
      execute(sql) {
        raw.exec(sql);
        return Promise.resolve();
      },
      readAppliedVersions: () => Promise.resolve([]),
      recordAppliedVersion: () => Promise.resolve(),
    });
  }
  return { raw, database: adapter(raw) };
}

const AS_NEEDED_DRAFT: TreatmentDraft = {
  specialtyCis: '60000002',
  specialtyName: 'Bêta',
  pharmaceuticalForm: 'comprimé',
  dosageKind: 'AS_NEEDED',
  includedInPillbox: false,
  phases: [],
  asNeededInfo: { maxQuantityPerDayHalfUnits: 8, minIntervalHours: 4 },
  controlledDispensing: null,
};

describe('traitements « si besoin »', () => {
  it('crée un traitement si besoin sans phase ni inclusion pilulier', async () => {
    const { database } = await setup();
    const id = await createTreatment(database, AS_NEEDED_DRAFT);

    const treatment = await getTreatment(database, id);

    expect(treatment).toMatchObject({
      dosageKind: 'AS_NEEDED',
      includedInPillbox: false,
      phases: [],
      asNeededInfo: { maxQuantityPerDayHalfUnits: 8, minIntervalHours: 4 },
    });
  });

  it('rejette un traitement si besoin avec une phase planifiée', async () => {
    const { database } = await setup();
    await expect(
      createTreatment(database, {
        ...AS_NEEDED_DRAFT,
        phases: [
          {
            id: null,
            startDate: '2026-08-01',
            endDate: null,
            frequency: { type: 'daily' },
            dosage: [{ slot: 'morning', quantityHalfUnits: 2 }],
          },
        ],
      }),
    ).rejects.toThrow('posologie planifiée');
  });

  it('rejette un traitement si besoin inclus dans le pilulier', async () => {
    const { database } = await setup();
    await expect(
      createTreatment(database, {
        ...AS_NEEDED_DRAFT,
        includedInPillbox: true,
      }),
    ).rejects.toThrow('inclus dans le pilulier');
  });

  it('permet de modifier les informations déclaratives si besoin', async () => {
    const { database } = await setup();
    const id = await createTreatment(database, AS_NEEDED_DRAFT);
    const treatment = await getTreatment(database, id);
    if (treatment === null) throw new Error('Traitement introuvable.');

    await updateTreatment(database, {
      ...treatment,
      asNeededInfo: { maxQuantityPerDayHalfUnits: null, minIntervalHours: 6 },
    });

    expect(await getTreatment(database, id)).toMatchObject({
      asNeededInfo: { maxQuantityPerDayHalfUnits: null, minIntervalHours: 6 },
    });
  });

  it('exige l’archivage plutôt que la suppression dès qu’une prise ponctuelle est enregistrée', async () => {
    const { raw, database } = await setup();
    const id = await createTreatment(database, AS_NEEDED_DRAFT);
    raw
      .prepare(
        `INSERT INTO as_needed_intake_records (treatment_id, taken_at, quantity_half_units)
         VALUES (?, '2026-08-11T10:00:00.000Z', 2)`,
      )
      .run(id);

    expect(await getTreatmentRemovalAction(database, id)).toBe('ARCHIVE');
  });
});
