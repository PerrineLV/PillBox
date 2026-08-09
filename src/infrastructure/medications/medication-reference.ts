import type { SQLiteDatabase } from 'expo-sqlite';

import { buildMedicationFtsQuery } from '@/domain/medications/normalize-medication-search';

export type MedicationPresentation = {
  cip13: string;
  label: string;
};

export type MedicationSearchResult = {
  cis: string;
  name: string;
  pharmaceuticalForm: string | null;
  presentations: MedicationPresentation[];
};

export type IdentifiedMedicationPresentation = {
  cip13: string;
  label: string;
  cis: string;
  name: string;
  pharmaceuticalForm: string | null;
};

type SpecialtySearchRow = {
  cis: string;
  name: string;
  pharmaceutical_form: string | null;
};

type PresentationRow = {
  cis: string;
  cip13: string;
  label: string;
};

type IdentifiedPresentationRow = {
  cip13: string;
  label: string;
  cis: string;
  name: string;
  pharmaceutical_form: string | null;
};

export async function findMedicationPresentationByCip13(
  database: SQLiteDatabase,
  cip13: string,
): Promise<IdentifiedMedicationPresentation | null> {
  if (!/^\d{13}$/.test(cip13)) return null;

  const row = await database.getFirstAsync<IdentifiedPresentationRow>(
    `SELECT p.cip13, p.label, s.cis, s.name, s.pharmaceutical_form
     FROM presentations p
     JOIN specialties s ON s.cis = p.cis
     WHERE p.cip13 = ?`,
    cip13,
  );
  if (row === null) return null;

  return {
    cip13: row.cip13,
    label: row.label,
    cis: row.cis,
    name: row.name,
    pharmaceuticalForm: row.pharmaceutical_form,
  };
}

export async function searchMedicationReference(
  database: SQLiteDatabase,
  searchText: string,
  limit = 30,
): Promise<MedicationSearchResult[]> {
  const query = buildMedicationFtsQuery(searchText);
  if (query === null) return [];

  const specialties = await database.getAllAsync<SpecialtySearchRow>(
    `SELECT s.cis, s.name, s.pharmaceutical_form
     FROM medication_search
     JOIN specialties s ON s.cis = medication_search.cis
     WHERE medication_search MATCH ?
     ORDER BY bm25(medication_search), s.name
     LIMIT ?`,
    query,
    limit,
  );
  if (specialties.length === 0) return [];

  const placeholders = specialties.map(() => '?').join(', ');
  const presentations = await database.getAllAsync<PresentationRow>(
    `SELECT cis, cip13, label
     FROM presentations
     WHERE cis IN (${placeholders})
     ORDER BY cis, cip13`,
    ...specialties.map((specialty) => specialty.cis),
  );
  const presentationsByCis = new Map<string, MedicationPresentation[]>();
  for (const presentation of presentations) {
    const values = presentationsByCis.get(presentation.cis) ?? [];
    values.push({ cip13: presentation.cip13, label: presentation.label });
    presentationsByCis.set(presentation.cis, values);
  }

  return specialties.map((specialty) => ({
    cis: specialty.cis,
    name: specialty.name,
    pharmaceuticalForm: specialty.pharmaceutical_form,
    presentations: presentationsByCis.get(specialty.cis) ?? [],
  }));
}
