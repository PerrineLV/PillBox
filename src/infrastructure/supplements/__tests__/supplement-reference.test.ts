import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';

import { searchSupplementReference } from '../supplement-reference';

describe('recherche Compl’Alim', () => {
  it('recherche par nom sans importer de posologie', async () => {
    const raw = new Database(':memory:');
    try {
      raw.exec(`
        CREATE TABLE supplements (id TEXT PRIMARY KEY, name TEXT, brand TEXT, form TEXT);
        CREATE VIRTUAL TABLE supplement_search USING fts5(id UNINDEXED, name, brand, form);
        INSERT INTO supplements VALUES ('42', 'Vitamine C', 'Marque A', 'Gélule');
        INSERT INTO supplement_search VALUES ('42', 'Vitamine C', 'Marque A', 'Gélule');
      `);
      const database = {
        getAllAsync<T>(
          sql: string,
          ...parameters: readonly (string | number)[]
        ): Promise<T[]> {
          return Promise.resolve(raw.prepare(sql).all(...parameters) as T[]);
        },
      } as SQLiteDatabase;
      await expect(
        searchSupplementReference(database, 'Vitamine'),
      ).resolves.toEqual([
        {
          externalId: '42',
          name: 'Vitamine C',
          brand: 'Marque A',
          form: 'Gélule',
        },
      ]);
      await expect(searchSupplementReference(database, '')).resolves.toEqual(
        [],
      );
    } finally {
      raw.close();
    }
  });
});
