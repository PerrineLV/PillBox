import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';

import { SCHEMA_MIGRATIONS } from '@/infrastructure/database/schema-migrations';

import { confirmGenericEquivalence } from '../generic-equivalence-repository';
import { findGenericEquivalenceCandidates } from '../generic-equivalence-candidates';

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

async function createPersonalDatabase() {
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

function insertTreatment(
  raw: Database.Database,
  overrides: Readonly<{
    specialtyCis: string;
    specialtyName: string;
    archivedAt?: string | null;
  }>,
): number {
  const result = raw
    .prepare(
      `INSERT INTO treatments (specialty_cis, specialty_name, archived_at)
       VALUES (?, ?, ?)`,
    )
    .run(
      overrides.specialtyCis,
      overrides.specialtyName,
      overrides.archivedAt ?? null,
    );
  return Number(result.lastInsertRowid);
}

function createReferenceDatabase() {
  const raw = new Database(':memory:');
  raw.exec(`
    CREATE TABLE specialties (
      cis TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      pharmaceutical_form TEXT
    );
    CREATE TABLE generic_groups (
      group_id TEXT NOT NULL,
      cis TEXT NOT NULL,
      group_label TEXT NOT NULL,
      type TEXT,
      sort_number TEXT,
      PRIMARY KEY (group_id, cis)
    );
  `);
  return { raw, database: adapter(raw) };
}

describe('findGenericEquivalenceCandidates', () => {
  it('propose un traitement actif dont le CIS appartient au même groupe générique, jamais encore confirmé', async () => {
    const { raw: personalRaw, database: personalDatabase } =
      await createPersonalDatabase();
    const { raw: referenceRaw, database: referenceDatabase } =
      createReferenceDatabase();
    insertTreatment(personalRaw, {
      specialtyCis: '60000001',
      specialtyName: 'Zoloft',
    });
    referenceRaw.exec(`
      INSERT INTO specialties (cis, name) VALUES
        ('60000001', 'Zoloft'), ('60000002', 'Sertraline');
      INSERT INTO generic_groups (group_id, cis, group_label, sort_number) VALUES
        ('10', '60000001', 'Groupe sertraline', '1'),
        ('10', '60000002', 'Groupe sertraline', '2');
    `);

    const candidates = await findGenericEquivalenceCandidates(
      personalDatabase,
      referenceDatabase,
      '60000002',
    );

    expect(candidates).toEqual([
      {
        treatmentId: expect.any(Number),
        treatmentName: 'Zoloft',
        groupLabel: 'Groupe sertraline',
      },
    ]);
  });

  it('exclut un traitement dont le CIS scanné/sélectionné est identique (comportement inchangé)', async () => {
    const { raw: personalRaw, database: personalDatabase } =
      await createPersonalDatabase();
    const { database: referenceDatabase } = createReferenceDatabase();
    insertTreatment(personalRaw, {
      specialtyCis: '60000001',
      specialtyName: 'Zoloft',
    });

    expect(
      await findGenericEquivalenceCandidates(
        personalDatabase,
        referenceDatabase,
        '60000001',
      ),
    ).toEqual([]);
  });

  it('exclut un traitement archivé', async () => {
    const { raw: personalRaw, database: personalDatabase } =
      await createPersonalDatabase();
    const { raw: referenceRaw, database: referenceDatabase } =
      createReferenceDatabase();
    insertTreatment(personalRaw, {
      specialtyCis: '60000001',
      specialtyName: 'Zoloft',
      archivedAt: '2026-01-01T00:00:00.000Z',
    });
    referenceRaw.exec(`
      INSERT INTO generic_groups (group_id, cis, group_label, sort_number) VALUES
        ('10', '60000001', 'Groupe sertraline', '1'),
        ('10', '60000002', 'Groupe sertraline', '2');
    `);

    expect(
      await findGenericEquivalenceCandidates(
        personalDatabase,
        referenceDatabase,
        '60000002',
      ),
    ).toEqual([]);
  });

  it('exclut un CIS hors groupe générique commun', async () => {
    const { raw: personalRaw, database: personalDatabase } =
      await createPersonalDatabase();
    const { raw: referenceRaw, database: referenceDatabase } =
      createReferenceDatabase();
    insertTreatment(personalRaw, {
      specialtyCis: '60000001',
      specialtyName: 'Zoloft',
    });
    referenceRaw.exec(`
      INSERT INTO generic_groups (group_id, cis, group_label, sort_number) VALUES
        ('20', '60000003', 'Groupe sans rapport', '1'),
        ('20', '60000004', 'Groupe sans rapport', '2');
    `);

    expect(
      await findGenericEquivalenceCandidates(
        personalDatabase,
        referenceDatabase,
        '60000004',
      ),
    ).toEqual([]);
  });

  it('exclut un couple (traitement, CIS) déjà confirmé et mémorisé', async () => {
    const { raw: personalRaw, database: personalDatabase } =
      await createPersonalDatabase();
    const { raw: referenceRaw, database: referenceDatabase } =
      createReferenceDatabase();
    const treatmentId = insertTreatment(personalRaw, {
      specialtyCis: '60000001',
      specialtyName: 'Zoloft',
    });
    referenceRaw.exec(`
      INSERT INTO generic_groups (group_id, cis, group_label, sort_number) VALUES
        ('10', '60000001', 'Groupe sertraline', '1'),
        ('10', '60000002', 'Groupe sertraline', '2');
    `);
    await confirmGenericEquivalence(personalDatabase, {
      treatmentId,
      cis: '60000002',
      specialtyName: 'Sertraline',
      groupLabel: 'Groupe sertraline',
    });

    expect(
      await findGenericEquivalenceCandidates(
        personalDatabase,
        referenceDatabase,
        '60000002',
      ),
    ).toEqual([]);
  });

  it('redemande une confirmation pour un nouveau membre du même groupe jamais confirmé, même si un autre membre l’est déjà', async () => {
    const { raw: personalRaw, database: personalDatabase } =
      await createPersonalDatabase();
    const { raw: referenceRaw, database: referenceDatabase } =
      createReferenceDatabase();
    const treatmentId = insertTreatment(personalRaw, {
      specialtyCis: '60000001',
      specialtyName: 'Zoloft',
    });
    referenceRaw.exec(`
      INSERT INTO generic_groups (group_id, cis, group_label, sort_number) VALUES
        ('10', '60000001', 'Groupe sertraline', '1'),
        ('10', '60000002', 'Groupe sertraline', '2'),
        ('10', '60000003', 'Groupe sertraline', '3');
    `);
    await confirmGenericEquivalence(personalDatabase, {
      treatmentId,
      cis: '60000002',
      specialtyName: 'Sertraline A',
      groupLabel: 'Groupe sertraline',
    });

    const candidates = await findGenericEquivalenceCandidates(
      personalDatabase,
      referenceDatabase,
      '60000003',
    );

    expect(candidates).toEqual([
      { treatmentId, treatmentName: 'Zoloft', groupLabel: 'Groupe sertraline' },
    ]);
  });
});
