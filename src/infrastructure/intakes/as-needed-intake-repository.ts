import type { SQLiteDatabase } from 'expo-sqlite';

import {
  assertValidAsNeededIntakeDraft,
  type AsNeededIntakeDraft,
  type AsNeededIntakeRecord,
} from '@/domain/intakes/as-needed-intake';

type AsNeededIntakeRow = {
  id: number;
  treatment_id: number;
  taken_at: string;
  quantity_half_units: number;
  note: string | null;
  created_at: string;
};

/**
 * N'enregistre volontairement aucun mouvement de stock : un traitement « si
 * besoin » n'est jamais inclus dans une préparation de pilulier (ticket 19),
 * donc rien n'a encore été décompté du stock au moment de cette prise.
 * Décrémenter automatiquement ici demanderait de désigner la boîte utilisée,
 * hors périmètre de ce ticket ; un ajustement manuel du stock (ticket 06)
 * reste possible si besoin.
 */
export async function recordAsNeededIntake(
  database: SQLiteDatabase,
  draft: AsNeededIntakeDraft,
): Promise<number> {
  assertValidAsNeededIntakeDraft(draft);
  const result = await database.runAsync(
    `INSERT INTO as_needed_intake_records
     (treatment_id, taken_at, quantity_half_units, note)
     VALUES (?, ?, ?, ?)`,
    draft.treatmentId,
    draft.takenAt,
    draft.quantityHalfUnits,
    draft.note,
  );
  return result.lastInsertRowId;
}

/**
 * Retour immédiat sur une prise enregistrée d'un seul geste depuis l'accueil.
 * Aucun mouvement de stock n'ayant été écrit à l'enregistrement, il n'y a rien
 * à compenser : la ligne disparaît, sans trace ni ajustement.
 */
export async function deleteAsNeededIntake(
  database: SQLiteDatabase,
  id: number,
): Promise<void> {
  await database.runAsync(
    'DELETE FROM as_needed_intake_records WHERE id = ?',
    id,
  );
}

export async function listAsNeededIntakes(
  database: SQLiteDatabase,
  treatmentId: number,
): Promise<AsNeededIntakeRecord[]> {
  const rows = await database.getAllAsync<AsNeededIntakeRow>(
    `SELECT id, treatment_id, taken_at, quantity_half_units, note, created_at
     FROM as_needed_intake_records WHERE treatment_id = ?
     ORDER BY taken_at DESC, id DESC`,
    treatmentId,
  );
  return rows.map(hydrateAsNeededIntake);
}

export type AsNeededIntakeRangeFilters = Readonly<{
  startAt: string | null;
  endAt: string;
  treatmentId: number | null;
}>;

/**
 * Prises « si besoin » de tous les traitements sur une période, utilisées par
 * les statistiques descriptives (ticket 20). `startAt`/`endAt` sont des
 * horodatages ISO comparés tels quels : `taken_at` est déjà stocké au format
 * ISO, la comparaison lexicographique correspond donc à l'ordre chronologique.
 */
export async function listAsNeededIntakesInRange(
  database: SQLiteDatabase,
  filters: AsNeededIntakeRangeFilters,
): Promise<AsNeededIntakeRecord[]> {
  const conditions = ['taken_at <= ?'];
  const parameters: (string | number)[] = [filters.endAt];
  if (filters.startAt !== null) {
    conditions.push('taken_at >= ?');
    parameters.push(filters.startAt);
  }
  if (filters.treatmentId !== null) {
    conditions.push('treatment_id = ?');
    parameters.push(filters.treatmentId);
  }
  const rows = await database.getAllAsync<AsNeededIntakeRow>(
    `SELECT id, treatment_id, taken_at, quantity_half_units, note, created_at
     FROM as_needed_intake_records WHERE ${conditions.join(' AND ')}
     ORDER BY taken_at DESC, id DESC`,
    ...parameters,
  );
  return rows.map(hydrateAsNeededIntake);
}

export async function getLastAsNeededIntake(
  database: SQLiteDatabase,
  treatmentId: number,
): Promise<AsNeededIntakeRecord | null> {
  const row = await database.getFirstAsync<AsNeededIntakeRow>(
    `SELECT id, treatment_id, taken_at, quantity_half_units, note, created_at
     FROM as_needed_intake_records WHERE treatment_id = ?
     ORDER BY taken_at DESC, id DESC LIMIT 1`,
    treatmentId,
  );
  return row === null ? null : hydrateAsNeededIntake(row);
}

function hydrateAsNeededIntake(row: AsNeededIntakeRow): AsNeededIntakeRecord {
  return {
    id: row.id,
    treatmentId: row.treatment_id,
    takenAt: row.taken_at,
    quantityHalfUnits: row.quantity_half_units,
    note: row.note,
    createdAt: row.created_at,
  };
}
