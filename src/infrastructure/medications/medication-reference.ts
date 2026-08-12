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

export type GenericGroupMember = {
  groupId: string;
  groupLabel: string;
  cis: string;
  name: string | null;
  type: string | null;
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

type GenericGroupMemberRow = {
  group_id: string;
  group_label: string;
  cis: string;
  name: string | null;
  type: string | null;
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

/**
 * Détection BDPM (`CIS_CPD_bdpm`, ticket 30) d'une mention connue de
 * délivrance encadrée (stupéfiants et assimilés, délivrance fractionnée)
 * pour une spécialité. Purement indicative et faillible : conditionne
 * uniquement l'affichage d'une case à cocher que l'utilisatrice confirme ou
 * écarte elle-même, jamais une activation automatique. `false` lorsque le
 * référentiel n'a jamais importé `CIS_CPD_bdpm` ou n'a repéré aucune mention
 * pour ce CIS.
 */
export async function detectControlledDispensingMention(
  database: SQLiteDatabase,
  cis: string,
): Promise<boolean> {
  if (!/^\d{8}$/.test(cis)) return false;

  const tableExists = await database.getFirstAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dispensing_conditions'`,
  );
  if (tableExists === null) return false;

  const row = await database.getFirstAsync<{ detected: number }>(
    `SELECT EXISTS(
       SELECT 1 FROM dispensing_conditions
       WHERE cis = ? AND controlled_dispensing_mention = 1
     ) AS detected`,
    cis,
  );
  return row?.detected === 1;
}

/**
 * Membres d'un groupe générique officiel (BDPM), à l'exclusion du CIS demandé.
 * Une spécialité peut appartenir à plusieurs groupes (ex. complémentarité
 * posologique entre dosages) : tous sont retournés, sans en privilégier un.
 * Purement informatif : n'influence ni ne filtre aucune donnée de stock,
 * boîte ou préparation.
 */
export async function getGenericGroupMembers(
  database: SQLiteDatabase,
  cis: string,
): Promise<GenericGroupMember[]> {
  if (!/^\d{8}$/.test(cis)) return [];

  const rows = await database.getAllAsync<GenericGroupMemberRow>(
    `SELECT gg.group_id, gg.group_label, gg.cis, s.name, gg.type
     FROM generic_groups gg
     LEFT JOIN specialties s ON s.cis = gg.cis
     WHERE gg.group_id IN (
       SELECT group_id FROM generic_groups WHERE cis = ?
     )
     AND gg.cis != ?
     ORDER BY gg.group_id, CAST(gg.sort_number AS INTEGER), gg.cis`,
    cis,
    cis,
  );

  return rows.map((row) => ({
    groupId: row.group_id,
    groupLabel: row.group_label,
    cis: row.cis,
    name: row.name,
    type: row.type,
  }));
}
