import type { SQLiteDatabase } from 'expo-sqlite';

import { buildMedicationFtsQuery } from '@/domain/medications/normalize-medication-search';

export type SupplementSearchResult = {
  externalId: string;
  name: string;
  brand: string | null;
  form: string | null;
};

type SupplementRow = {
  id: string;
  name: string;
  brand: string | null;
  form: string | null;
};

/** Recherche locale dans les seules déclarations commercialisables du snapshot. */
export async function searchSupplementReference(
  database: SQLiteDatabase,
  searchText: string,
  limit = 30,
): Promise<SupplementSearchResult[]> {
  const query = buildMedicationFtsQuery(searchText);
  if (query === null) return [];
  const rows = await database.getAllAsync<SupplementRow>(
    `SELECT s.id, s.name, s.brand, s.form
     FROM supplement_search
     JOIN supplements s ON s.id = supplement_search.id
     WHERE supplement_search MATCH ?
     ORDER BY bm25(supplement_search), s.name LIMIT ?`,
    query,
    limit,
  );
  return rows.map((row) => ({
    externalId: row.id,
    name: row.name,
    brand: row.brand,
    form: row.form,
  }));
}
