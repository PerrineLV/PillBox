import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';

import {
  assertValidBoxDraft,
  MEDICATION_BOX_ORIGINS,
  STOCK_MOVEMENT_TYPES,
  type MedicationBox,
  type MedicationBoxDraft,
  type MedicationBoxOrigin,
  type StockMovement,
  type StockMovementType,
} from '@/domain/inventory/inventory';

type BoxRow = {
  id: number;
  specialty_cis: string;
  specialty_name: string;
  pharmaceutical_form: string | null;
  presentation_cip13: string;
  presentation_label: string;
  lot: string | null;
  expiration_date: string;
  initial_quantity: number;
  remaining_quantity: number;
  source: string;
  scan_raw: string;
};

type MovementRow = {
  id: number;
  box_id: number;
  type: string;
  quantity_delta: number;
  quantity_after: number;
  explanation: string;
  created_at: string;
};

export async function listMedicationBoxes(
  database: SQLiteDatabase,
): Promise<MedicationBox[]> {
  const rows = await database.getAllAsync<BoxRow>(
    `${BOX_SELECT} ORDER BY specialty_name, lot, expiration_date, id`,
  );
  return rows.map(hydrateBox);
}

export async function getMedicationBox(
  database: SQLiteDatabase,
  id: number,
): Promise<MedicationBox | null> {
  const row = await database.getFirstAsync<BoxRow>(
    `${BOX_SELECT} WHERE id = ?`,
    id,
  );
  return row === null ? null : hydrateBox(row);
}

export async function addMedicationBox(
  database: SQLiteDatabase,
  draft: MedicationBoxDraft,
): Promise<number> {
  assertValidBoxDraft(draft);
  let insert: SQLiteRunResult | null = null;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    insert = await transaction.runAsync(
      `INSERT INTO medication_boxes
       (specialty_cis, specialty_name, pharmaceutical_form, presentation_cip13,
        presentation_label, lot, expiration_date, initial_quantity,
        remaining_quantity, source, scan_raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      draft.specialtyCis,
      draft.specialtyName,
      draft.pharmaceuticalForm,
      draft.presentationCip13,
      draft.presentationLabel,
      emptyToNull(draft.lot),
      draft.expirationDate,
      draft.initialQuantity,
      draft.initialQuantity,
      draft.origin,
      draft.scanRaw ?? '',
    );
    await transaction.runAsync(
      `INSERT INTO stock_movements
       (box_id, type, quantity_delta, quantity_after, explanation)
       VALUES (?, 'BOX_ADDED', ?, ?, ?)`,
      insert.lastInsertRowId,
      draft.initialQuantity,
      draft.initialQuantity,
      draft.origin === 'SCAN'
        ? 'Ajout de la boîte au stock après scan'
        : 'Ajout manuel de la boîte au stock',
    );
  });
  if (insert === null) throw new Error('La boîte n’a pas pu être ajoutée.');
  return (insert as SQLiteRunResult).lastInsertRowId;
}

/**
 * Suite réservée à une boîte : suppression définitive, ou conservation lorsque
 * la supprimer effacerait ce qui a réellement été préparé, ou lorsqu'une
 * préparation en cours la désigne déjà.
 */
export type MedicationBoxRemovalAction =
  | 'DELETE'
  | 'KEEP_USED_IN_PREPARATION'
  | 'KEEP_USED_FOR_OUTSIDE_PILLBOX_INTAKE'
  | 'KEEP_IN_DRAFT_PREPARATION';

/**
 * Une boîte n'est supprimable que si elle n'a laissé aucune trace dans une
 * préparation. `preparation_box_usages` et le mouvement `PILLBOX_PREPARATION`
 * sont écrits ensemble à la validation : les deux sont vérifiés pour ne
 * dépendre d'aucune supposition sur ce lien. `preparation_progress` marque une
 * boîte déjà désignée dans une préparation encore en cours ; rien n'a été
 * consommé, mais la supprimer romprait la préparation, donc on refuse.
 */
export async function getMedicationBoxRemovalAction(
  database: SQLiteDatabase,
  boxId: number,
): Promise<MedicationBoxRemovalAction> {
  const row = await database.getFirstAsync<{
    used_in_preparation: number;
    used_for_outside_pillbox_intake: number;
    drafted: number;
  }>(
    `SELECT
       EXISTS(
         SELECT 1 FROM preparation_box_usages WHERE box_id = ?
         UNION ALL
         SELECT 1 FROM stock_movements
           WHERE box_id = ? AND type = 'PILLBOX_PREPARATION'
       ) AS used_in_preparation,
       EXISTS(
         SELECT 1 FROM stock_movements
         WHERE box_id = ? AND type = 'OUTSIDE_PILLBOX_INTAKE'
       ) AS used_for_outside_pillbox_intake,
       EXISTS(SELECT 1 FROM preparation_progress WHERE box_id = ?) AS drafted`,
    boxId,
    boxId,
    boxId,
    boxId,
  );
  if (row === null) {
    throw new Error('Impossible de vérifier l’usage de cette boîte.');
  }
  if (row.used_in_preparation === 1) return 'KEEP_USED_IN_PREPARATION';
  if (row.used_for_outside_pillbox_intake === 1)
    return 'KEEP_USED_FOR_OUTSIDE_PILLBOX_INTAKE';
  if (row.drafted === 1) return 'KEEP_IN_DRAFT_PREPARATION';
  return 'DELETE';
}

/**
 * Supprime définitivement une boîte ajoutée par erreur ou en doublon, avec ses
 * mouvements de stock. La vérification est refaite dans la transaction : une
 * préparation validée entre l'affichage de l'écran et la confirmation doit
 * bloquer la suppression plutôt que d'effacer un historique réel.
 */
export async function deleteUnusedMedicationBox(
  database: SQLiteDatabase,
  boxId: number,
): Promise<void> {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const box = await transaction.getFirstAsync<{ id: number }>(
      'SELECT id FROM medication_boxes WHERE id = ?',
      boxId,
    );
    if (box === null) throw new Error('Boîte introuvable.');
    const action = await getMedicationBoxRemovalAction(transaction, boxId);
    if (action === 'KEEP_USED_IN_PREPARATION') {
      throw new Error(
        'Cette boîte a déjà servi à une préparation : sa suppression effacerait cet historique. Pour la retirer du stock utilisable, ajustez sa quantité restante à 0.',
      );
    }
    if (action === 'KEEP_USED_FOR_OUTSIDE_PILLBOX_INTAKE') {
      throw new Error(
        'Cette boîte a déjà servi à une prise hors pilulier : sa suppression effacerait cet historique. Pour la retirer du stock utilisable, ajustez sa quantité restante à 0.',
      );
    }
    if (action === 'KEEP_IN_DRAFT_PREPARATION') {
      throw new Error(
        'Cette boîte est désignée dans une préparation en cours. Terminez ou annulez cette préparation avant de la supprimer.',
      );
    }
    await transaction.runAsync(
      'DELETE FROM stock_movements WHERE box_id = ?',
      boxId,
    );
    const deleted = await transaction.runAsync(
      'DELETE FROM medication_boxes WHERE id = ?',
      boxId,
    );
    if (deleted.changes !== 1) {
      throw new Error('La boîte n’a pas pu être supprimée.');
    }
  });
}

export async function adjustMedicationBox(
  database: SQLiteDatabase,
  boxId: number,
  quantityAfter: number,
  type: Exclude<StockMovementType, 'BOX_ADDED'>,
  explanation: string,
): Promise<void> {
  if (!Number.isInteger(quantityAfter) || quantityAfter < 0) {
    throw new Error('La quantité restante doit être un entier positif ou nul.');
  }
  if (type !== 'MANUAL_ADJUSTMENT' && type !== 'CORRECTION') {
    throw new Error('Le type de mouvement est invalide.');
  }
  if (explanation.trim() === '') {
    throw new Error('Une explication est requise pour ajuster le stock.');
  }
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const current = await transaction.getFirstAsync<{
      remaining_quantity: number;
    }>('SELECT remaining_quantity FROM medication_boxes WHERE id = ?', boxId);
    if (current === null) throw new Error('Boîte introuvable.');
    const result = await transaction.runAsync(
      `UPDATE medication_boxes SET remaining_quantity = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND remaining_quantity = ?`,
      quantityAfter,
      boxId,
      current.remaining_quantity,
    );
    if (result.changes !== 1) {
      throw new Error('Le stock a changé. Rechargez la boîte puis réessayez.');
    }
    await transaction.runAsync(
      `INSERT INTO stock_movements
       (box_id, type, quantity_delta, quantity_after, explanation)
       VALUES (?, ?, ?, ?, ?)`,
      boxId,
      type,
      quantityAfter - current.remaining_quantity,
      quantityAfter,
      explanation.trim(),
    );
  });
}

export async function listStockMovements(
  database: SQLiteDatabase,
  boxId: number,
): Promise<StockMovement[]> {
  const rows = await database.getAllAsync<MovementRow>(
    `SELECT id, box_id, type, quantity_delta, quantity_after, explanation, created_at
     FROM stock_movements WHERE box_id = ? ORDER BY id DESC`,
    boxId,
  );
  return rows.map((row) => {
    if (!isMovementType(row.type)) {
      throw new Error('La base locale contient un mouvement inconnu.');
    }
    return {
      id: row.id,
      boxId: row.box_id,
      type: row.type,
      quantityDelta: row.quantity_delta,
      quantityAfter: row.quantity_after,
      explanation: row.explanation,
      createdAt: row.created_at,
    };
  });
}

function hydrateBox(row: BoxRow): MedicationBox {
  if (!isBoxOrigin(row.source)) {
    throw new Error('La base locale contient une origine de boîte inconnue.');
  }
  return {
    id: row.id,
    specialtyCis: row.specialty_cis,
    specialtyName: row.specialty_name,
    pharmaceuticalForm: row.pharmaceutical_form,
    presentationCip13: row.presentation_cip13,
    presentationLabel: row.presentation_label,
    lot: row.lot,
    expirationDate: row.expiration_date,
    initialQuantity: row.initial_quantity,
    remainingQuantity: row.remaining_quantity,
    origin: row.source,
    scanRaw: row.scan_raw === '' ? null : row.scan_raw,
  };
}

function emptyToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function isMovementType(value: string): value is StockMovementType {
  return (STOCK_MOVEMENT_TYPES as readonly string[]).includes(value);
}

function isBoxOrigin(value: string): value is MedicationBoxOrigin {
  return (MEDICATION_BOX_ORIGINS as readonly string[]).includes(value);
}

const BOX_SELECT = `SELECT id, specialty_cis, specialty_name, pharmaceutical_form,
  presentation_cip13, presentation_label, lot, expiration_date,
  initial_quantity, remaining_quantity, source, scan_raw FROM medication_boxes`;
