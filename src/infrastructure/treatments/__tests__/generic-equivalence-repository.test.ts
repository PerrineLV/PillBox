import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';

import { SCHEMA_MIGRATIONS } from '@/infrastructure/database/schema-migrations';

import {
  confirmGenericEquivalence,
  forgetGenericEquivalence,
  isGenericEquivalenceConfirmed,
  listAllGenericEquivalenceConfirmations,
  listGenericEquivalenceConfirmations,
} from '../generic-equivalence-repository';

type SqlParameters = readonly (string | number | null)[];

function adapter(raw: Database.Database): SQLiteDatabase {
  const api = {
    async getAllAsync<T>(sql: string, ...parameters: SqlParameters) {
      return raw.prepare(sql).all(...parameters) as T[];
    },
    async getFirstAsync<T>(sql: string, ...parameters: SqlParameters) {
      return (raw.prepare(sql).get(...parameters) as T | undefined) ?? null;
    },
    async runAsync(sql: string, ...parameters: SqlParameters) {
      const result = raw.prepare(sql).run(...parameters);
      return {
        changes: result.changes,
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },
  };
  return api as unknown as SQLiteDatabase;
}

async function createDatabase() {
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
  const treatment = raw
    .prepare(
      `INSERT INTO treatments (specialty_cis, specialty_name) VALUES ('60000001', 'Zoloft')`,
    )
    .run();
  return {
    raw,
    database: adapter(raw),
    treatmentId: Number(treatment.lastInsertRowid),
  };
}

describe('generic-equivalence-repository', () => {
  it("n'est pas confirmée tant qu'elle n'a jamais été mémorisée", async () => {
    const { database, treatmentId } = await createDatabase();
    expect(
      await isGenericEquivalenceConfirmed(database, treatmentId, '60000002'),
    ).toBe(false);
  });

  it('mémorise une confirmation puis la retrouve', async () => {
    const { database, treatmentId } = await createDatabase();
    await confirmGenericEquivalence(database, {
      treatmentId,
      cis: '60000002',
      specialtyName: 'Sertraline',
      groupLabel: 'Groupe sertraline',
    });

    expect(
      await isGenericEquivalenceConfirmed(database, treatmentId, '60000002'),
    ).toBe(true);
    expect(
      await listGenericEquivalenceConfirmations(database, treatmentId),
    ).toEqual([
      expect.objectContaining({
        treatmentId,
        cis: '60000002',
        specialtyName: 'Sertraline',
        groupLabel: 'Groupe sertraline',
      }),
    ]);
  });

  it("n'exige pas de reconfirmation pour un CIS déjà confirmé, mais en exige une pour un autre membre du même groupe", async () => {
    const { database, treatmentId } = await createDatabase();
    await confirmGenericEquivalence(database, {
      treatmentId,
      cis: '60000002',
      specialtyName: 'Sertraline',
      groupLabel: 'Groupe sertraline',
    });

    expect(
      await isGenericEquivalenceConfirmed(database, treatmentId, '60000002'),
    ).toBe(true);
    expect(
      await isGenericEquivalenceConfirmed(database, treatmentId, '60000003'),
    ).toBe(false);
  });

  it('oublier une équivalence redemande une confirmation à la vérification suivante', async () => {
    const { database, treatmentId } = await createDatabase();
    await confirmGenericEquivalence(database, {
      treatmentId,
      cis: '60000002',
      specialtyName: 'Sertraline',
      groupLabel: 'Groupe sertraline',
    });

    await forgetGenericEquivalence(database, treatmentId, '60000002');

    expect(
      await isGenericEquivalenceConfirmed(database, treatmentId, '60000002'),
    ).toBe(false);
    expect(
      await listGenericEquivalenceConfirmations(database, treatmentId),
    ).toEqual([]);
  });

  it('ne confirme jamais deux fois la même date de première confirmation', async () => {
    const { database, treatmentId } = await createDatabase();
    await confirmGenericEquivalence(database, {
      treatmentId,
      cis: '60000002',
      specialtyName: 'Sertraline',
      groupLabel: 'Groupe sertraline',
    });
    const first = await listGenericEquivalenceConfirmations(
      database,
      treatmentId,
    );

    await confirmGenericEquivalence(database, {
      treatmentId,
      cis: '60000002',
      specialtyName: 'Sertraline (libellé mis à jour)',
      groupLabel: 'Groupe sertraline',
    });
    const second = await listGenericEquivalenceConfirmations(
      database,
      treatmentId,
    );

    expect(second[0].confirmedAt).toBe(first[0].confirmedAt);
    expect(second[0].specialtyName).toBe('Sertraline (libellé mis à jour)');
  });

  it('liste les équivalences mémorisées de tous les traitements, sans filtre', async () => {
    const { raw, database, treatmentId } = await createDatabase();
    const otherTreatment = raw
      .prepare(
        `INSERT INTO treatments (specialty_cis, specialty_name) VALUES ('60000010', 'Doliprane')`,
      )
      .run();
    const otherTreatmentId = Number(otherTreatment.lastInsertRowid);

    await confirmGenericEquivalence(database, {
      treatmentId,
      cis: '60000002',
      specialtyName: 'Sertraline',
      groupLabel: 'Groupe sertraline',
    });
    await confirmGenericEquivalence(database, {
      treatmentId: otherTreatmentId,
      cis: '60000011',
      specialtyName: 'Paracétamol',
      groupLabel: 'Groupe paracétamol',
    });

    const all = await listAllGenericEquivalenceConfirmations(database);
    expect(all).toEqual([
      expect.objectContaining({ treatmentId, cis: '60000002' }),
      expect.objectContaining({
        treatmentId: otherTreatmentId,
        cis: '60000011',
      }),
    ]);
  });
});
