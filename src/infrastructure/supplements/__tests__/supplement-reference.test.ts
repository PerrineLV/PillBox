import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  listSupplementForms,
  searchSupplementReference,
} from '../supplement-reference';
import { normalizeMedicationSearch } from '@/domain/medications/normalize-medication-search';

it('distingue les homonymes, dédoublonne les références et recherche tous les mots', async () => {
  const raw = new Database(':memory:');
  try {
    raw.exec(`CREATE TABLE supplements (id TEXT PRIMARY KEY, name TEXT, brand TEXT, form TEXT, operator TEXT, product_range TEXT, normalized_name TEXT, normalized_brand TEXT);
      CREATE VIRTUAL TABLE supplement_search USING fts5(id UNINDEXED, name, brand, form, operator, product_range);`);
    for (const [id, name, brand, form, operator] of [
      ['1', 'Magnésium bisglycinate renforcé', 'Alpha', 'Gélule', 'Société A'],
      ['2', 'Magnésium bisglycinate', 'Béta', 'Gélule', 'Société B'],
      ['3', 'Magnésium bisglycinate', null, 'Comprimé', 'Opérateur C'],
      ['4', 'Magnésium bisglycinate', 'Béta', 'Gélule', 'Société B'],
    ]) {
      raw
        .prepare('INSERT INTO supplements VALUES (?,?,?,?,?,?,?,?)')
        .run(
          id,
          name,
          brand,
          form,
          operator,
          null,
          normalizeMedicationSearch(name!),
          normalizeMedicationSearch(brand ?? ''),
        );
      raw
        .prepare('INSERT INTO supplement_search VALUES (?,?,?,?,?,?)')
        .run(
          id,
          normalizeMedicationSearch(name!),
          normalizeMedicationSearch(brand ?? ''),
          form,
          operator,
          null,
        );
    }
    raw.exec(
      "INSERT INTO supplement_search SELECT * FROM supplement_search WHERE id='2'",
    );
    const database = {
      getAllAsync: async (sql: string, ...params: (string | number | null)[]) =>
        raw.prepare(sql).all(...params),
    } as unknown as SQLiteDatabase;
    const results = await searchSupplementReference(
      database,
      '  MAGNÉSIUM   BISGLYCINATE ',
    );
    expect(results.map((row) => row.externalId)).toEqual(['2', '3', '4', '1']);
    expect(results[1]).toMatchObject({ brand: null, operator: 'Opérateur C' });
    expect(
      (await searchSupplementReference(database, 'magnesium beta')).map(
        (row) => row.externalId,
      ),
    ).toEqual(['2', '4']);
    expect(
      (await searchSupplementReference(database, 'beta magnesium')).map(
        (row) => row.externalId,
      ),
    ).toEqual(['2', '4']);
    expect(
      (
        await searchSupplementReference(database, 'magnesium', 30, 'Comprimé')
      ).map((row) => row.externalId),
    ).toEqual(['3']);
    expect(await listSupplementForms(database, 'magnesium')).toEqual([
      'Comprimé',
      'Gélule',
    ]);
    expect(await searchSupplementReference(database, '   ')).toEqual([]);
    expect(await searchSupplementReference(database, 'inexistant')).toEqual([]);
  } finally {
    raw.close();
  }
});
