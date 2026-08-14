import type { SQLiteDatabase } from 'expo-sqlite';

import {
  assertValidPrescriptionDraft,
  assertValidPrescriptionItemDraft,
  computePrescriptionStatus,
  PRESCRIPTION_ITEM_DISPENSING_MODES,
  PRESCRIPTION_ITEM_QUANTITY_KINDS,
  type Prescription,
  type PrescriptionDraft,
  type PrescriptionItem,
  type PrescriptionItemDispensingMode,
  type PrescriptionItemDraft,
  type PrescriptionItemQuantityKind,
} from '@/domain/prescriptions/prescription';

type PrescriptionRow = {
  id: number;
  label: string;
  issue_date: string;
  valid_until: string | null;
  is_replaced: number;
};

type PrescriptionItemRow = {
  id: number;
  prescription_id: number;
  treatment_id: number;
  quantity_kind: string;
  duration_days: number | null;
  box_count: number | null;
  dispensing_mode: string;
  periodicity_days: number | null;
  last_dispensed_at: string | null;
  theoretical_renewal_date: string | null;
  tolerance_days: number | null;
};

const PRESCRIPTION_SELECT = `
  SELECT p.id, p.label, p.issue_date, p.valid_until,
    EXISTS(
      SELECT 1 FROM prescription_items pi
      JOIN prescription_items pi2 ON pi2.treatment_id = pi.treatment_id
      JOIN prescriptions p2 ON p2.id = pi2.prescription_id
      WHERE pi.prescription_id = p.id
        AND p2.id <> p.id
        AND (p2.issue_date > p.issue_date OR (p2.issue_date = p.issue_date AND p2.id > p.id))
    ) AS is_replaced
  FROM prescriptions p`;

/**
 * Une ordonnance est « active » un instant donné si son statut, dérivé de
 * `validUntil` et de la présence d'une ordonnance plus récente couvrant au
 * moins un même traitement, vaut ACTIVE à cette date (voir
 * `computePrescriptionStatus`). Purement informatif, jamais bloquant.
 */
export async function listPrescriptions(
  database: SQLiteDatabase,
  today: string,
): Promise<Prescription[]> {
  const rows = await database.getAllAsync<PrescriptionRow>(
    `${PRESCRIPTION_SELECT} ORDER BY p.issue_date DESC, p.id DESC`,
  );
  return rows.map((row) => hydratePrescription(row, today));
}

export async function getPrescription(
  database: SQLiteDatabase,
  id: number,
  today: string,
): Promise<Prescription | null> {
  const row = await database.getFirstAsync<PrescriptionRow>(
    `${PRESCRIPTION_SELECT} WHERE p.id = ?`,
    id,
  );
  return row === null ? null : hydratePrescription(row, today);
}

export async function createPrescription(
  database: SQLiteDatabase,
  draft: PrescriptionDraft,
): Promise<number> {
  assertValidPrescriptionDraft(draft);
  const result = await database.runAsync(
    `INSERT INTO prescriptions (label, issue_date, valid_until) VALUES (?, ?, ?)`,
    draft.label,
    draft.issueDate,
    draft.validUntil,
  );
  return result.lastInsertRowId;
}

export async function updatePrescription(
  database: SQLiteDatabase,
  id: number,
  draft: PrescriptionDraft,
): Promise<void> {
  assertValidPrescriptionDraft(draft);
  const result = await database.runAsync(
    `UPDATE prescriptions SET label = ?, issue_date = ?, valid_until = ?,
     updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    draft.label,
    draft.issueDate,
    draft.validUntil,
    id,
  );
  if (result.changes !== 1) throw new Error('Ordonnance introuvable.');
}

/**
 * Une ordonnance qui couvre déjà au moins un traitement fait partie de
 * l'historique (elle devient EXPIRED ou REPLACED, jamais supprimée) : seule
 * une ordonnance créée par erreur, sans aucune ligne, peut être retirée.
 */
export async function deletePrescription(
  database: SQLiteDatabase,
  id: number,
): Promise<void> {
  const usage = await database.getFirstAsync<{ used: number }>(
    `SELECT EXISTS(SELECT 1 FROM prescription_items WHERE prescription_id = ?) AS used`,
    id,
  );
  if (usage?.used === 1)
    throw new Error(
      'Cette ordonnance couvre déjà un traitement et fait partie de l’historique : elle ne peut pas être supprimée.',
    );
  const result = await database.runAsync(
    'DELETE FROM prescriptions WHERE id = ?',
    id,
  );
  if (result.changes !== 1) throw new Error('Ordonnance introuvable.');
}

/**
 * Toutes les lignes d'ordonnance, triées par date d'émission décroissante de
 * leur ordonnance : pour un même traitement, la première ligne rencontrée par
 * un appelant qui dédoublonne (ex. `buildRenewalList`) est ainsi la plus
 * récente — au plus un item « actif » par traitement a du sens
 * fonctionnellement, sans être contraint en base (ticket 45).
 */
export async function listPrescriptionItems(
  database: SQLiteDatabase,
): Promise<PrescriptionItem[]> {
  const rows = await database.getAllAsync<PrescriptionItemRow>(
    `SELECT pi.id, pi.prescription_id, pi.treatment_id, pi.quantity_kind, pi.duration_days,
      pi.box_count, pi.dispensing_mode, pi.periodicity_days, pi.last_dispensed_at,
      pi.theoretical_renewal_date, pi.tolerance_days
     FROM prescription_items pi
     JOIN prescriptions p ON p.id = pi.prescription_id
     ORDER BY p.issue_date DESC, pi.id DESC`,
  );
  return rows.map(hydratePrescriptionItem);
}

export async function listPrescriptionItemsByPrescription(
  database: SQLiteDatabase,
  prescriptionId: number,
): Promise<PrescriptionItem[]> {
  const rows = await database.getAllAsync<PrescriptionItemRow>(
    `${PRESCRIPTION_ITEM_SELECT} WHERE prescription_id = ? ORDER BY id`,
    prescriptionId,
  );
  return rows.map(hydratePrescriptionItem);
}

export async function listPrescriptionItemsByTreatment(
  database: SQLiteDatabase,
  treatmentId: number,
): Promise<PrescriptionItem[]> {
  const rows = await database.getAllAsync<PrescriptionItemRow>(
    `${PRESCRIPTION_ITEM_SELECT} WHERE treatment_id = ? ORDER BY id`,
    treatmentId,
  );
  return rows.map(hydratePrescriptionItem);
}

export async function getPrescriptionItem(
  database: SQLiteDatabase,
  id: number,
): Promise<PrescriptionItem | null> {
  const row = await database.getFirstAsync<PrescriptionItemRow>(
    `${PRESCRIPTION_ITEM_SELECT} WHERE id = ?`,
    id,
  );
  return row === null ? null : hydratePrescriptionItem(row);
}

export async function createPrescriptionItem(
  database: SQLiteDatabase,
  draft: PrescriptionItemDraft,
): Promise<number> {
  assertValidPrescriptionItemDraft(draft);
  const result = await database.runAsync(
    `INSERT INTO prescription_items
     (prescription_id, treatment_id, quantity_kind, duration_days, box_count,
      dispensing_mode, periodicity_days, last_dispensed_at, theoretical_renewal_date, tolerance_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    draft.prescriptionId,
    draft.treatmentId,
    draft.quantityKind,
    draft.durationDays,
    draft.boxCount,
    draft.dispensingMode,
    draft.periodicityDays,
    draft.lastDispensedAt,
    draft.theoreticalRenewalDate,
    draft.toleranceDays,
  );
  return result.lastInsertRowId;
}

export async function updatePrescriptionItem(
  database: SQLiteDatabase,
  item: PrescriptionItem,
): Promise<void> {
  assertValidPrescriptionItemDraft(item);
  const result = await database.runAsync(
    `UPDATE prescription_items SET prescription_id = ?, treatment_id = ?, quantity_kind = ?,
     duration_days = ?, box_count = ?, dispensing_mode = ?, periodicity_days = ?,
     last_dispensed_at = ?, theoretical_renewal_date = ?, tolerance_days = ?,
     updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    item.prescriptionId,
    item.treatmentId,
    item.quantityKind,
    item.durationDays,
    item.boxCount,
    item.dispensingMode,
    item.periodicityDays,
    item.lastDispensedAt,
    item.theoreticalRenewalDate,
    item.toleranceDays,
    item.id,
  );
  if (result.changes !== 1) throw new Error('Ligne d’ordonnance introuvable.');
}

export async function deletePrescriptionItem(
  database: SQLiteDatabase,
  id: number,
): Promise<void> {
  const result = await database.runAsync(
    'DELETE FROM prescription_items WHERE id = ?',
    id,
  );
  if (result.changes !== 1) throw new Error('Ligne d’ordonnance introuvable.');
}

const PRESCRIPTION_ITEM_SELECT = `SELECT id, prescription_id, treatment_id, quantity_kind,
  duration_days, box_count, dispensing_mode, periodicity_days, last_dispensed_at,
  theoretical_renewal_date, tolerance_days FROM prescription_items`;

function hydratePrescription(
  row: PrescriptionRow,
  today: string,
): Prescription {
  return {
    id: row.id,
    label: row.label,
    issueDate: row.issue_date,
    validUntil: row.valid_until,
    status: computePrescriptionStatus(
      { validUntil: row.valid_until },
      row.is_replaced === 1,
      today,
    ),
  };
}

function hydratePrescriptionItem(row: PrescriptionItemRow): PrescriptionItem {
  if (!isPrescriptionItemQuantityKind(row.quantity_kind))
    throw new Error('La base locale contient un type de quantité invalide.');
  if (!isPrescriptionItemDispensingMode(row.dispensing_mode))
    throw new Error('La base locale contient un mode de délivrance invalide.');
  return {
    id: row.id,
    prescriptionId: row.prescription_id,
    treatmentId: row.treatment_id,
    quantityKind: row.quantity_kind,
    durationDays: row.duration_days,
    boxCount: row.box_count,
    dispensingMode: row.dispensing_mode,
    periodicityDays: row.periodicity_days,
    lastDispensedAt: row.last_dispensed_at,
    theoreticalRenewalDate: row.theoretical_renewal_date,
    toleranceDays: row.tolerance_days,
  };
}

function isPrescriptionItemQuantityKind(
  value: string,
): value is PrescriptionItemQuantityKind {
  return PRESCRIPTION_ITEM_QUANTITY_KINDS.some((kind) => kind === value);
}

function isPrescriptionItemDispensingMode(
  value: string,
): value is PrescriptionItemDispensingMode {
  return PRESCRIPTION_ITEM_DISPENSING_MODES.some((mode) => mode === value);
}
