import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Correspondance générique confirmée explicitement pour un traitement précis :
 * un autre membre du même groupe générique officiel (BDPM) a été accepté
 * comme boîte utilisable pour ce traitement. Ne modifie jamais la spécialité
 * enregistrée du traitement lui-même.
 */
export type GenericEquivalenceConfirmation = Readonly<{
  treatmentId: number;
  cis: string;
  specialtyName: string;
  groupLabel: string;
  confirmedAt: string;
}>;

export async function isGenericEquivalenceConfirmed(
  database: SQLiteDatabase,
  treatmentId: number,
  cis: string,
): Promise<boolean> {
  const row = await database.getFirstAsync<{ found: number }>(
    `SELECT 1 AS found FROM generic_equivalence_confirmations
     WHERE treatment_id = ? AND cis = ?`,
    treatmentId,
    cis,
  );
  return row !== null;
}

/**
 * Mémorise une équivalence pour ce couple (traitement, CIS) précis, sans
 * jamais l'étendre à un autre membre du même groupe non encore confirmé.
 * Idempotent : reconfirmer un couple déjà mémorisé ne change que la donnée
 * affichée (nom/libellé), jamais la date de première confirmation.
 */
export async function confirmGenericEquivalence(
  database: SQLiteDatabase,
  confirmation: Readonly<{
    treatmentId: number;
    cis: string;
    specialtyName: string;
    groupLabel: string;
  }>,
): Promise<void> {
  await database.runAsync(
    `INSERT INTO generic_equivalence_confirmations
      (treatment_id, cis, specialty_name, group_label)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(treatment_id, cis) DO UPDATE SET
       specialty_name = excluded.specialty_name,
       group_label = excluded.group_label`,
    confirmation.treatmentId,
    confirmation.cis,
    confirmation.specialtyName,
    confirmation.groupLabel,
  );
}

export async function listGenericEquivalenceConfirmations(
  database: SQLiteDatabase,
  treatmentId: number,
): Promise<GenericEquivalenceConfirmation[]> {
  const rows = await database.getAllAsync<{
    treatment_id: number;
    cis: string;
    specialty_name: string;
    group_label: string;
    confirmed_at: string;
  }>(
    `SELECT treatment_id, cis, specialty_name, group_label, confirmed_at
     FROM generic_equivalence_confirmations
     WHERE treatment_id = ?
     ORDER BY confirmed_at`,
    treatmentId,
  );
  return rows.map((row) => ({
    treatmentId: row.treatment_id,
    cis: row.cis,
    specialtyName: row.specialty_name,
    groupLabel: row.group_label,
    confirmedAt: row.confirmed_at,
  }));
}

/**
 * Oublie une équivalence mémorisée : ne modifie ni ne supprime aucune boîte,
 * mouvement de stock ou préparation déjà enregistrés. La prochaine
 * vérification de ce CIS pour ce traitement redemandera une confirmation
 * explicite.
 */
export async function forgetGenericEquivalence(
  database: SQLiteDatabase,
  treatmentId: number,
  cis: string,
): Promise<void> {
  await database.runAsync(
    'DELETE FROM generic_equivalence_confirmations WHERE treatment_id = ? AND cis = ?',
    treatmentId,
    cis,
  );
}
