import type { SQLiteDatabase } from 'expo-sqlite';

import {
  buildMedicationFtsQuery,
  normalizeMedicationSearch,
} from '@/domain/medications/normalize-medication-search';

export type SupplementSearchResult = {
  externalId: string;
  name: string;
  brand: string | null;
  form: string | null;
  operator: string | null;
  productRange: string | null;
};

type SupplementRow = Omit<
  SupplementSearchResult,
  'externalId' | 'productRange'
> & {
  id: string;
  product_range: string | null;
};

/** Une référence canonique par identifiant, même si l'index FTS la répète. */
export async function searchSupplementReference(
  database: SQLiteDatabase,
  searchText: string,
  limit = 30,
  form: string | null = null,
): Promise<SupplementSearchResult[]> {
  const query = buildMedicationFtsQuery(searchText);
  if (query === null) return [];
  const normalized = normalizeMedicationSearch(searchText);
  const rows = await database.getAllAsync<SupplementRow>(
    `SELECT s.id, s.name, s.brand, s.form, s.operator, s.product_range
     FROM supplements s
     WHERE s.id IN (SELECT id FROM supplement_search WHERE supplement_search MATCH ?)
       AND (? IS NULL OR s.form = ?)
     ORDER BY CASE
       WHEN s.normalized_name = ? THEN 0
       WHEN s.normalized_name || ' ' || s.normalized_brand = ? THEN 1
       WHEN s.normalized_brand = ? THEN 2
       ELSE 3 END, s.name, s.id
     LIMIT ?`,
    query,
    form,
    form,
    normalized,
    normalized,
    normalized,
    limit,
  );
  return rows.map((row) => ({
    externalId: row.id,
    name: row.name,
    brand: row.brand,
    form: row.form,
    operator: row.operator,
    productRange: row.product_range,
  }));
}

/** Facettes sur tous les résultats correspondants, avant la limite d'affichage. */
export async function listSupplementForms(
  database: SQLiteDatabase,
  searchText: string,
): Promise<string[]> {
  const query = buildMedicationFtsQuery(searchText);
  if (query === null) return [];
  const rows = await database.getAllAsync<{ form: string }>(
    `SELECT DISTINCT form FROM supplements
     WHERE id IN (SELECT id FROM supplement_search WHERE supplement_search MATCH ?)
       AND form IS NOT NULL
     ORDER BY form`,
    query,
  );
  return rows.map((row) => row.form);
}
