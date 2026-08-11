import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';

import { buildMedicationFtsQuery } from '@/domain/medications/normalize-medication-search';

import { getGenericGroupMembers } from '../medication-reference';

type SqlParameters = readonly (string | number | null)[];

function adapter(raw: Database.Database): SQLiteDatabase {
  const api = {
    async getAllAsync<T>(sql: string, ...parameters: SqlParameters) {
      return raw.prepare(sql).all(...parameters) as T[];
    },
  };
  return api as unknown as SQLiteDatabase;
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

describe('getGenericGroupMembers', () => {
  it("retourne les autres membres d'un groupe générique, triés par numéro de tri", async () => {
    const { raw, database } = createReferenceDatabase();
    raw.exec(`
      INSERT INTO specialties (cis, name, pharmaceutical_form) VALUES
        ('60000001', 'PRINCEPS 250 mg', 'comprimé'),
        ('60000002', 'GENERIQUE A 250 mg', 'comprimé'),
        ('60000003', 'GENERIQUE B 250 mg', 'comprimé');
      INSERT INTO generic_groups (group_id, cis, group_label, type, sort_number) VALUES
        ('10', '60000001', 'GROUPE TEST 250 mg', '0', '1'),
        ('10', '60000003', 'GROUPE TEST 250 mg', '1', '3'),
        ('10', '60000002', 'GROUPE TEST 250 mg', '1', '2');
    `);

    const members = await getGenericGroupMembers(database, '60000001');

    expect(members).toEqual([
      {
        groupId: '10',
        groupLabel: 'GROUPE TEST 250 mg',
        cis: '60000002',
        name: 'GENERIQUE A 250 mg',
        type: '1',
      },
      {
        groupId: '10',
        groupLabel: 'GROUPE TEST 250 mg',
        cis: '60000003',
        name: 'GENERIQUE B 250 mg',
        type: '1',
      },
    ]);
  });

  it('ne retourne rien pour une spécialité sans groupe générique', async () => {
    const { raw, database } = createReferenceDatabase();
    raw.exec(
      `INSERT INTO specialties (cis, name, pharmaceutical_form) VALUES ('60000009', 'SOLO 10 mg', NULL);`,
    );

    expect(await getGenericGroupMembers(database, '60000009')).toEqual([]);
  });

  it("affiche un type absent tel quel, sans l'interpréter ni le masquer", async () => {
    const { raw, database } = createReferenceDatabase();
    raw.exec(`
      INSERT INTO specialties (cis, name, pharmaceutical_form) VALUES
        ('60000001', 'PRINCEPS 250 mg', 'comprimé'),
        ('60000002', 'MYSTERE 250 mg', 'comprimé');
      INSERT INTO generic_groups (group_id, cis, group_label, type, sort_number) VALUES
        ('20', '60000001', 'GROUPE MYSTERE', '0', '1'),
        ('20', '60000002', 'GROUPE MYSTERE', NULL, '2');
    `);

    const members = await getGenericGroupMembers(database, '60000001');

    expect(members).toEqual([
      {
        groupId: '20',
        groupLabel: 'GROUPE MYSTERE',
        cis: '60000002',
        name: 'MYSTERE 250 mg',
        type: null,
      },
    ]);
  });

  it("conserve un membre dont le CIS est absent des spécialités, sans l'inventer ni le masquer", async () => {
    const { raw, database } = createReferenceDatabase();
    raw.exec(`
      INSERT INTO specialties (cis, name, pharmaceutical_form) VALUES
        ('60000001', 'PRINCEPS 250 mg', 'comprimé');
      INSERT INTO generic_groups (group_id, cis, group_label, type, sort_number) VALUES
        ('30', '60000001', 'GROUPE INCOMPLET', '0', '1'),
        ('30', '69999999', 'GROUPE INCOMPLET', '1', '2');
    `);

    const members = await getGenericGroupMembers(database, '60000001');

    expect(members).toEqual([
      {
        groupId: '30',
        groupLabel: 'GROUPE INCOMPLET',
        cis: '69999999',
        name: null,
        type: '1',
      },
    ]);
  });

  it('conserve des groupes distincts quand un CIS appartient à plusieurs groupes génériques', async () => {
    const { raw, database } = createReferenceDatabase();
    raw.exec(`
      INSERT INTO specialties (cis, name, pharmaceutical_form) VALUES
        ('60000001', 'DOSAGE 250 mg', 'comprimé'),
        ('60000002', 'DOSAGE 500 mg', 'comprimé');
      INSERT INTO generic_groups (group_id, cis, group_label, type, sort_number) VALUES
        ('40', '60000001', 'GROUPE 250 mg', '1', '1'),
        ('41', '60000001', 'GROUPE 500 mg (complémentarité)', '2', '1'),
        ('41', '60000002', 'GROUPE 500 mg (complémentarité)', '1', '2');
    `);

    const members = await getGenericGroupMembers(database, '60000001');

    expect(members).toEqual([
      {
        groupId: '41',
        groupLabel: 'GROUPE 500 mg (complémentarité)',
        cis: '60000002',
        name: 'DOSAGE 500 mg',
        type: '1',
      },
    ]);
  });
});

describe('buildMedicationFtsQuery', () => {
  it('normalise casse, accents et dosage en préfixes FTS sûrs', () => {
    expect(buildMedicationFtsQuery('Éfféralgan 500 mg')).toBe(
      'efferalgan* AND 500* AND mg*',
    );
  });

  it('ignore une recherche vide ou uniquement ponctuée', () => {
    expect(buildMedicationFtsQuery(' -- ')).toBeNull();
  });

  it('retrouve aussi un dosage saisi sans espace', () => {
    expect(buildMedicationFtsQuery('500mg')).toBe('500* AND mg*');
  });
});
