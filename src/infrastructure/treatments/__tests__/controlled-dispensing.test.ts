import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { TreatmentDraft } from '@/domain/treatments/treatment';
import { SCHEMA_MIGRATIONS } from '@/infrastructure/database/schema-migrations';
import {
  createTreatment,
  getTreatment,
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

const BASE_DRAFT: TreatmentDraft = {
  specialtyCis: '60000003',
  specialtyName: 'Gamma',
  pharmaceuticalForm: 'comprimé',
  dosageKind: 'SCHEDULED',
  includedInPillbox: true,
  phases: [
    {
      id: null,
      startDate: '2026-08-01',
      endDate: null,
      frequency: { type: 'daily' },
      dosage: [{ slot: 'morning', quantityHalfUnits: 2 }],
    },
  ],
  asNeededInfo: { maxQuantityPerDayHalfUnits: null, minIntervalHours: null },
  controlledDispensing: null,
};

describe('délivrance encadrée (ticket 30)', () => {
  it('persiste `null` pour une spécialité jamais détectée', async () => {
    const { database } = await setup();
    const id = await createTreatment(database, BASE_DRAFT);

    expect(await getTreatment(database, id)).toMatchObject({
      controlledDispensing: null,
    });
  });

  it('enregistre l’indicateur pré-coché avec sa périodicité par défaut', async () => {
    const { database } = await setup();
    const id = await createTreatment(database, {
      ...BASE_DRAFT,
      controlledDispensing: {
        enabled: true,
        periodicityDays: 28,
        lastDispensedAt: null,
        theoreticalRenewalDate: null,
      },
    });

    expect(await getTreatment(database, id)).toMatchObject({
      controlledDispensing: {
        enabled: true,
        periodicityDays: 28,
        lastDispensedAt: null,
        theoreticalRenewalDate: null,
      },
    });
  });

  it('recalcule et conserve la date théorique fournie par le domaine', async () => {
    const { database } = await setup();
    const id = await createTreatment(database, {
      ...BASE_DRAFT,
      controlledDispensing: {
        enabled: true,
        periodicityDays: 28,
        lastDispensedAt: '2026-08-01',
        theoreticalRenewalDate: '2026-08-29',
      },
    });

    expect(await getTreatment(database, id)).toMatchObject({
      controlledDispensing: {
        enabled: true,
        periodicityDays: 28,
        lastDispensedAt: '2026-08-01',
        theoreticalRenewalDate: '2026-08-29',
      },
    });
  });

  it('conserve un indicateur décoché par l’utilisatrice, distinct d’une non-détection', async () => {
    const { database } = await setup();
    const id = await createTreatment(database, {
      ...BASE_DRAFT,
      controlledDispensing: {
        enabled: true,
        periodicityDays: 28,
        lastDispensedAt: null,
        theoreticalRenewalDate: null,
      },
    });
    const treatment = await getTreatment(database, id);
    if (treatment === null) throw new Error('Traitement introuvable.');

    await updateTreatment(database, {
      ...treatment,
      controlledDispensing: {
        ...treatment.controlledDispensing!,
        enabled: false,
      },
    });

    expect(await getTreatment(database, id)).toMatchObject({
      controlledDispensing: { enabled: false, periodicityDays: 28 },
    });
  });

  it('rejette une périodicité non positive', async () => {
    const { database } = await setup();
    await expect(
      createTreatment(database, {
        ...BASE_DRAFT,
        controlledDispensing: {
          enabled: true,
          periodicityDays: 0,
          lastDispensedAt: null,
          theoreticalRenewalDate: null,
        },
      }),
    ).rejects.toThrow('périodicité');
  });

  it('rejette une date de dernière délivrance mal formée', async () => {
    const { database } = await setup();
    await expect(
      createTreatment(database, {
        ...BASE_DRAFT,
        controlledDispensing: {
          enabled: true,
          periodicityDays: 28,
          lastDispensedAt: '01/08/2026',
          theoreticalRenewalDate: null,
        },
      }),
    ).rejects.toThrow('dernière délivrance');
  });

  it('ne modifie pas les traitements existants créés avant ce ticket', async () => {
    const { raw, database } = await setup();
    const id = await createTreatment(database, BASE_DRAFT);
    // Simule un traitement créé avant la migration 24 : les colonnes
    // n'existaient pas encore, ALTER TABLE les laisse à NULL par défaut.
    const row = raw
      .prepare(
        `SELECT controlled_dispensing_enabled, controlled_dispensing_periodicity_days,
         controlled_dispensing_last_dispensed_at, controlled_dispensing_theoretical_renewal_date
         FROM treatments WHERE id = ?`,
      )
      .get(id) as Record<string, unknown>;

    expect(row).toEqual({
      controlled_dispensing_enabled: null,
      controlled_dispensing_periodicity_days: null,
      controlled_dispensing_last_dispensed_at: null,
      controlled_dispensing_theoretical_renewal_date: null,
    });
  });
});
