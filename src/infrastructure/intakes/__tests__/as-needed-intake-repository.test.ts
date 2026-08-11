import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';

import { SCHEMA_MIGRATIONS } from '@/infrastructure/database/schema-migrations';
import {
  getLastAsNeededIntake,
  listAsNeededIntakes,
  listAsNeededIntakesInRange,
  recordAsNeededIntake,
} from '../as-needed-intake-repository';

type Parameters = readonly (string | number | null)[];
type TestDatabase = {
  getFirstAsync<T>(sql: string, ...parameters: Parameters): Promise<T | null>;
  getAllAsync<T>(sql: string, ...parameters: Parameters): Promise<T[]>;
  runAsync(
    sql: string,
    ...parameters: Parameters
  ): Promise<{ changes: number; lastInsertRowId: number }>;
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
  const treatmentId = Number(
    raw
      .prepare(
        `INSERT INTO treatments (specialty_cis, specialty_name, dosage_kind, included_in_pillbox)
         VALUES ('60000002', 'Bêta', 'AS_NEEDED', 0)`,
      )
      .run().lastInsertRowid,
  );
  return { raw, database: adapter(raw), treatmentId };
}

describe('prises ponctuelles « si besoin »', () => {
  it('n’a aucune prise et aucune dernière prise avant tout enregistrement', async () => {
    const { database, treatmentId } = await setup();
    expect(await getLastAsNeededIntake(database, treatmentId)).toBeNull();
    expect(await listAsNeededIntakes(database, treatmentId)).toEqual([]);
  });

  it('enregistre une prise et l’expose comme la dernière prise', async () => {
    const { database, treatmentId } = await setup();
    await recordAsNeededIntake(database, {
      treatmentId,
      takenAt: '2026-08-10T09:00:00.000Z',
      quantityHalfUnits: 2,
      note: null,
    });

    const last = await getLastAsNeededIntake(database, treatmentId);
    expect(last).toMatchObject({
      treatmentId,
      takenAt: '2026-08-10T09:00:00.000Z',
      quantityHalfUnits: 2,
      note: null,
    });
  });

  it('retient la prise la plus récente comme dernière prise, quel que soit l’ordre d’enregistrement', async () => {
    const { database, treatmentId } = await setup();
    await recordAsNeededIntake(database, {
      treatmentId,
      takenAt: '2026-08-10T09:00:00.000Z',
      quantityHalfUnits: 2,
      note: null,
    });
    await recordAsNeededIntake(database, {
      treatmentId,
      takenAt: '2026-08-09T20:00:00.000Z',
      quantityHalfUnits: 1,
      note: 'Douleur légère',
    });

    const last = await getLastAsNeededIntake(database, treatmentId);
    expect(last?.takenAt).toBe('2026-08-10T09:00:00.000Z');

    const history = await listAsNeededIntakes(database, treatmentId);
    expect(history.map((item) => item.takenAt)).toEqual([
      '2026-08-10T09:00:00.000Z',
      '2026-08-09T20:00:00.000Z',
    ]);
  });

  it('ne crée aucun mouvement de stock lors de l’enregistrement d’une prise', async () => {
    const { raw, database, treatmentId } = await setup();

    await recordAsNeededIntake(database, {
      treatmentId,
      takenAt: '2026-08-10T09:00:00.000Z',
      quantityHalfUnits: 2,
      note: null,
    });

    expect(
      raw.prepare('SELECT COUNT(*) count FROM stock_movements').get(),
    ).toEqual({ count: 0 });
  });

  it('rejette une prise invalide avant écriture', async () => {
    const { database, treatmentId } = await setup();
    await expect(
      recordAsNeededIntake(database, {
        treatmentId,
        takenAt: '2026-08-10T09:00:00.000Z',
        quantityHalfUnits: 0,
        note: null,
      }),
    ).rejects.toThrow('quantité');
    expect(await listAsNeededIntakes(database, treatmentId)).toEqual([]);
  });
});

describe('prises « si besoin » sur une période, tous traitements confondus', () => {
  it('filtre par plage de dates et par traitement, pour les statistiques', async () => {
    const { raw, database, treatmentId } = await setup();
    const otherTreatmentId = Number(
      raw
        .prepare(
          `INSERT INTO treatments (specialty_cis, specialty_name, dosage_kind, included_in_pillbox)
           VALUES ('60000003', 'Gamma', 'AS_NEEDED', 0)`,
        )
        .run().lastInsertRowid,
    );
    await recordAsNeededIntake(database, {
      treatmentId,
      takenAt: '2026-08-10T09:00:00.000Z',
      quantityHalfUnits: 2,
      note: null,
    });
    await recordAsNeededIntake(database, {
      treatmentId,
      takenAt: '2026-07-01T09:00:00.000Z',
      quantityHalfUnits: 1,
      note: null,
    });
    await recordAsNeededIntake(database, {
      treatmentId: otherTreatmentId,
      takenAt: '2026-08-11T09:00:00.000Z',
      quantityHalfUnits: 1,
      note: null,
    });

    const inAugust = await listAsNeededIntakesInRange(database, {
      startAt: '2026-08-01T00:00:00.000Z',
      endAt: '2026-08-31T23:59:59.999Z',
      treatmentId: null,
    });
    expect(inAugust.map((item) => item.takenAt)).toEqual([
      '2026-08-11T09:00:00.000Z',
      '2026-08-10T09:00:00.000Z',
    ]);

    const onlyFirstTreatment = await listAsNeededIntakesInRange(database, {
      startAt: null,
      endAt: '2026-12-31T23:59:59.999Z',
      treatmentId,
    });
    expect(onlyFirstTreatment.map((item) => item.takenAt)).toEqual([
      '2026-08-10T09:00:00.000Z',
      '2026-07-01T09:00:00.000Z',
    ]);
  });
});
