import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';

import {
  assertValidDosage,
  isIntakeSlot,
  isWeekday,
  type Dosage,
  type Treatment,
  type TreatmentDraft,
} from '@/domain/treatments/treatment';

type TreatmentRow = {
  id: number;
  specialty_cis: string;
  specialty_name: string;
  pharmaceutical_form: string | null;
  active: number;
  included_in_pillbox: number;
};

type DosageRow = {
  treatment_id: number;
  weekday: string;
  slot: string;
  quantity_half_units: number;
};

export async function listTreatments(
  database: SQLiteDatabase,
): Promise<Treatment[]> {
  const rows = await database.getAllAsync<TreatmentRow>(
    `${TREATMENT_SELECT} ORDER BY active DESC, specialty_name`,
  );
  return hydrateTreatments(database, rows);
}

export async function getTreatment(
  database: SQLiteDatabase,
  id: number,
): Promise<Treatment | null> {
  const row = await database.getFirstAsync<TreatmentRow>(
    `${TREATMENT_SELECT} WHERE id = ?`,
    id,
  );
  if (row === null) return null;
  return (await hydrateTreatments(database, [row]))[0] ?? null;
}

export async function createTreatment(
  database: SQLiteDatabase,
  draft: TreatmentDraft,
): Promise<number> {
  validateDraft(draft);
  let result: SQLiteRunResult | null = null;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    result = await transaction.runAsync(
      `INSERT INTO treatments
       (specialty_cis, specialty_name, pharmaceutical_form, active, included_in_pillbox)
       VALUES (?, ?, ?, ?, ?)`,
      draft.specialtyCis,
      draft.specialtyName,
      draft.pharmaceuticalForm,
      draft.active ? 1 : 0,
      draft.includedInPillbox ? 1 : 0,
    );
    await insertDosage(transaction, result.lastInsertRowId, draft.dosage);
  });
  if (result === null) throw new Error('Le traitement n’a pas pu être créé.');
  return (result as SQLiteRunResult).lastInsertRowId;
}

export async function updateTreatment(
  database: SQLiteDatabase,
  treatment: Treatment,
): Promise<void> {
  validateDraft(treatment);
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const result = await transaction.runAsync(
      `UPDATE treatments SET specialty_cis = ?, specialty_name = ?, pharmaceutical_form = ?,
       active = ?, included_in_pillbox = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      treatment.specialtyCis,
      treatment.specialtyName,
      treatment.pharmaceuticalForm,
      treatment.active ? 1 : 0,
      treatment.includedInPillbox ? 1 : 0,
      treatment.id,
    );
    if (result.changes !== 1) throw new Error('Traitement introuvable.');
    await transaction.runAsync(
      'DELETE FROM treatment_dosages WHERE treatment_id = ?',
      treatment.id,
    );
    await insertDosage(transaction, treatment.id, treatment.dosage);
  });
}

async function insertDosage(
  database: SQLiteDatabase,
  treatmentId: number,
  dosage: readonly Dosage[],
): Promise<void> {
  for (const item of dosage) {
    await database.runAsync(
      `INSERT INTO treatment_dosages (treatment_id, weekday, slot, quantity_half_units)
       VALUES (?, ?, ?, ?)`,
      treatmentId,
      item.weekday,
      item.slot,
      item.quantityHalfUnits,
    );
  }
}

async function hydrateTreatments(
  database: SQLiteDatabase,
  rows: readonly TreatmentRow[],
): Promise<Treatment[]> {
  if (rows.length === 0) return [];
  const placeholders = rows.map(() => '?').join(', ');
  const dosageRows = await database.getAllAsync<DosageRow>(
    `SELECT treatment_id, weekday, slot, quantity_half_units FROM treatment_dosages
     WHERE treatment_id IN (${placeholders}) ORDER BY treatment_id, weekday, slot`,
    ...rows.map((row) => row.id),
  );
  const dosageByTreatment = new Map<number, Dosage[]>();
  for (const row of dosageRows) {
    if (!isWeekday(row.weekday) || !isIntakeSlot(row.slot)) {
      throw new Error('La base locale contient une posologie invalide.');
    }
    const dosage = dosageByTreatment.get(row.treatment_id) ?? [];
    dosage.push({
      weekday: row.weekday,
      slot: row.slot,
      quantityHalfUnits: row.quantity_half_units,
    });
    dosageByTreatment.set(row.treatment_id, dosage);
  }
  return rows.map((row) => ({
    id: row.id,
    specialtyCis: row.specialty_cis,
    specialtyName: row.specialty_name,
    pharmaceuticalForm: row.pharmaceutical_form,
    active: row.active === 1,
    includedInPillbox: row.included_in_pillbox === 1,
    dosage: dosageByTreatment.get(row.id) ?? [],
  }));
}

function validateDraft(draft: TreatmentDraft): void {
  if (draft.specialtyCis.trim() === '' || draft.specialtyName.trim() === '') {
    throw new Error('La spécialité doit provenir du référentiel.');
  }
  assertValidDosage(draft.dosage);
}

const TREATMENT_SELECT = `SELECT id, specialty_cis, specialty_name, pharmaceutical_form,
  active, included_in_pillbox FROM treatments`;
