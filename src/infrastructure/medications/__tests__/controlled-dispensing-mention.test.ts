import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';

import { detectControlledDispensingMention } from '../medication-reference';

type SqlParameters = readonly (string | number | null)[];

function adapter(raw: Database.Database): SQLiteDatabase {
  const api = {
    async getFirstAsync<T>(sql: string, ...parameters: SqlParameters) {
      return (raw.prepare(sql).get(...parameters) as T | undefined) ?? null;
    },
  };
  return api as unknown as SQLiteDatabase;
}

function createReferenceDatabase() {
  const raw = new Database(':memory:');
  raw.exec(`
    CREATE TABLE dispensing_conditions (
      cis TEXT NOT NULL,
      condition_text TEXT NOT NULL,
      controlled_dispensing_mention INTEGER NOT NULL,
      PRIMARY KEY (cis, condition_text)
    );
  `);
  return { raw, database: adapter(raw) };
}

describe('detectControlledDispensingMention', () => {
  it('détecte une spécialité avec une condition marquée', async () => {
    const { raw, database } = createReferenceDatabase();
    raw.exec(`
      INSERT INTO dispensing_conditions (cis, condition_text, controlled_dispensing_mention) VALUES
        ('60000001', 'liste I', 0),
        ('60000001', 'stupéfiants', 1);
    `);

    expect(await detectControlledDispensingMention(database, '60000001')).toBe(
      true,
    );
  });

  it('ne détecte rien pour une spécialité sans condition marquée', async () => {
    const { raw, database } = createReferenceDatabase();
    raw.exec(`
      INSERT INTO dispensing_conditions (cis, condition_text, controlled_dispensing_mention) VALUES
        ('60000002', 'liste I', 0);
    `);

    expect(await detectControlledDispensingMention(database, '60000002')).toBe(
      false,
    );
  });

  it('ne détecte rien pour une spécialité absente du référentiel', async () => {
    const { database } = createReferenceDatabase();

    expect(await detectControlledDispensingMention(database, '60000009')).toBe(
      false,
    );
  });

  it('refuse un CIS mal formé sans interroger la base', async () => {
    const { database } = createReferenceDatabase();

    expect(await detectControlledDispensingMention(database, 'abc')).toBe(
      false,
    );
  });

  it("n'échoue pas lorsque le référentiel n'a jamais importé CIS_CPD_bdpm", async () => {
    const raw = new Database(':memory:');
    const database = adapter(raw);

    expect(await detectControlledDispensingMention(database, '60000001')).toBe(
      false,
    );
  });
});
