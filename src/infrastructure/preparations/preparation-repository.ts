import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';

import {
  assertVerificationEvidence,
  BOX_VERIFICATION_METHODS,
  type BoxVerificationMethod,
  type KnownPreparation,
  type PreparationSnapshot,
} from '@/domain/preparations/preparation';

export type SavedPreparationProgress = Readonly<{
  specialtyCis: string;
  boxId: number;
  /** Quantité couverte par cette boîte : le reste du besoin est apporté par d'autres lignes. */
  quantityHalfUnits: number;
  verification: BoxVerificationMethod;
  /** Chaîne brute du DataMatrix, absente lorsque la boîte a été choisie dans le stock. */
  scanRaw: string | null;
  nonFefoAcknowledged: boolean;
}>;

export type SavedPreparation = Readonly<{
  id: number;
  snapshot: PreparationSnapshot;
  progress: readonly SavedPreparationProgress[];
}>;

export type PreparationHistoryEntry = Readonly<{
  id: number;
  startDate: string;
  endDate: string;
  completedAt: string;
  medications: readonly Readonly<{
    specialtyCis: string;
    specialtyName: string;
    quantityHalfUnits: number;
    boxId: number;
    presentationCip13: string;
    presentationLabel: string;
    lot: string | null;
    expirationDate: string;
    verification: BoxVerificationMethod;
  }>[];
}>;

/**
 * Semaines déjà connues localement. Sert à empêcher un doublon et à proposer la
 * reprise d'une préparation incomplète plutôt qu'une nouvelle.
 */
export async function listPreparationWeeks(
  database: SQLiteDatabase,
): Promise<KnownPreparation[]> {
  const rows = await database.getAllAsync<{
    id: number;
    start_date: string;
    status: string;
  }>(
    `SELECT id, start_date, status FROM preparations
     ORDER BY start_date DESC, id DESC`,
  );
  return rows.map((row) => ({
    id: row.id,
    startDate: row.start_date,
    status: toPreparationStatus(row.status),
  }));
}

/**
 * Persiste uniquement un nouveau snapshot ; aucune mise à jour de son contenu
 * n'est exposée. La transaction refuse un doublon pour une semaine déjà validée
 * ainsi qu'une seconde préparation en cours : l'annulation ou la validation de
 * la préparation existante reste un geste explicite.
 */
export async function createPreparation(
  database: SQLiteDatabase,
  snapshot: PreparationSnapshot,
): Promise<number> {
  let insert: SQLiteRunResult | null = null;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const completed = await transaction.getFirstAsync<{ id: number }>(
      `SELECT id FROM preparations WHERE start_date = ? AND status = 'COMPLETED'`,
      snapshot.startDate,
    );
    if (completed !== null) {
      throw new Error('Cette semaine a déjà été préparée et validée.');
    }
    const draft = await transaction.getFirstAsync<{ id: number }>(
      `SELECT id FROM preparations WHERE status = 'DRAFT' ORDER BY id DESC LIMIT 1`,
    );
    if (draft !== null) {
      throw new Error(
        'Une préparation est déjà en cours. Reprenez-la ou annulez-la avant d’en démarrer une autre.',
      );
    }
    insert = await transaction.runAsync(
      `INSERT INTO preparations (start_date, end_date) VALUES (?, ?)`,
      snapshot.startDate,
      snapshot.endDate,
    );
    const preparationId = insert.lastInsertRowId;
    for (const item of snapshot.items) {
      await transaction.runAsync(
        `INSERT INTO preparation_items
         (preparation_id, source_treatment_id, specialty_cis, specialty_name,
          pharmaceutical_form, intake_date, slot, quantity_half_units)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        preparationId,
        item.treatmentId,
        item.specialtyCis,
        item.specialtyName,
        item.pharmaceuticalForm,
        item.date,
        item.slot,
        item.quantityHalfUnits,
      );
    }
    for (const requirement of snapshot.requirements) {
      await transaction.runAsync(
        `INSERT INTO preparation_requirements
         (preparation_id, specialty_cis, specialty_name, required_half_units,
          usable_stock_half_units, missing_half_units)
         VALUES (?, ?, ?, ?, ?, ?)`,
        preparationId,
        requirement.specialtyCis,
        requirement.specialtyName,
        requirement.requiredHalfUnits,
        requirement.usableStockHalfUnits,
        requirement.missingHalfUnits,
      );
    }
  });
  if (insert === null)
    throw new Error('La préparation n’a pas pu être enregistrée.');
  return (insert as SQLiteRunResult).lastInsertRowId;
}

export async function getLatestDraftPreparation(
  database: SQLiteDatabase,
): Promise<SavedPreparation | null> {
  const preparation = await database.getFirstAsync<{
    id: number;
    start_date: string;
    end_date: string;
  }>(
    `SELECT id, start_date, end_date FROM preparations
     WHERE status = 'DRAFT' ORDER BY id DESC LIMIT 1`,
  );
  if (preparation === null) return null;
  const items = await database.getAllAsync<{
    source_treatment_id: number;
    specialty_cis: string;
    specialty_name: string;
    pharmaceutical_form: string | null;
    intake_date: string;
    slot: PreparationSnapshot['items'][number]['slot'];
    quantity_half_units: number;
  }>(
    `SELECT source_treatment_id, specialty_cis, specialty_name,
      pharmaceutical_form, intake_date, slot, quantity_half_units
     FROM preparation_items WHERE preparation_id = ? ORDER BY id`,
    preparation.id,
  );
  const requirements = await database.getAllAsync<{
    specialty_cis: string;
    specialty_name: string;
    required_half_units: number;
    usable_stock_half_units: number;
    missing_half_units: number;
  }>(
    `SELECT specialty_cis, specialty_name, required_half_units,
      usable_stock_half_units, missing_half_units
     FROM preparation_requirements WHERE preparation_id = ?
     ORDER BY specialty_name`,
    preparation.id,
  );
  const progress = await database.getAllAsync<{
    specialty_cis: string;
    box_id: number;
    quantity_half_units: number;
    verification: string;
    scan_raw: string;
    non_fefo_acknowledged: number;
  }>(
    `SELECT specialty_cis, box_id, quantity_half_units, verification,
      scan_raw, non_fefo_acknowledged
     FROM preparation_progress WHERE preparation_id = ? ORDER BY box_id`,
    preparation.id,
  );
  const hydratedRequirements = requirements.map((row) => ({
    specialtyCis: row.specialty_cis,
    specialtyName: row.specialty_name,
    requiredHalfUnits: row.required_half_units,
    usableStockHalfUnits: row.usable_stock_half_units,
    missingHalfUnits: row.missing_half_units,
  }));
  return {
    id: preparation.id,
    snapshot: {
      startDate: preparation.start_date,
      endDate: preparation.end_date,
      items: items.map((row) => ({
        treatmentId: row.source_treatment_id,
        specialtyCis: row.specialty_cis,
        specialtyName: row.specialty_name,
        pharmaceuticalForm: row.pharmaceutical_form,
        date: row.intake_date,
        slot: row.slot,
        quantityHalfUnits: row.quantity_half_units,
      })),
      requirements: hydratedRequirements,
      hasShortages: hydratedRequirements.some(
        (item) => item.missingHalfUnits > 0,
      ),
    },
    progress: progress.map((row) => ({
      specialtyCis: row.specialty_cis,
      boxId: row.box_id,
      quantityHalfUnits: row.quantity_half_units,
      verification: toVerificationMethod(row.verification),
      scanRaw: row.scan_raw === '' ? null : row.scan_raw,
      nonFefoAcknowledged: row.non_fefo_acknowledged === 1,
    })),
  };
}

/**
 * Enregistre la contribution d'une boîte au besoin d'un médicament. Plusieurs
 * boîtes peuvent contribuer au même médicament : la ligne est identifiée par
 * boîte, pas seulement par médicament, afin qu'une boîte qui se termine en
 * cours de préparation puisse être complétée par une seconde sans écraser la
 * première.
 */
export async function savePreparationProgress(
  database: SQLiteDatabase,
  preparationId: number,
  progress: SavedPreparationProgress,
): Promise<void> {
  assertVerificationEvidence(progress.verification, progress.scanRaw);
  await database.runAsync(
    `INSERT INTO preparation_progress
      (preparation_id, specialty_cis, box_id, quantity_half_units,
       verification, scan_raw, non_fefo_acknowledged)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(preparation_id, specialty_cis, box_id) DO UPDATE SET
       quantity_half_units = excluded.quantity_half_units,
       verification = excluded.verification,
       scan_raw = excluded.scan_raw,
       non_fefo_acknowledged = excluded.non_fefo_acknowledged,
       completed_at = CURRENT_TIMESTAMP`,
    preparationId,
    progress.specialtyCis,
    progress.boxId,
    progress.quantityHalfUnits,
    progress.verification,
    progress.scanRaw ?? '',
    progress.nonFefoAcknowledged ? 1 : 0,
  );
}

/**
 * Abandonne une préparation en cours. Le snapshot et la progression sont
 * effacés : une préparation jamais validée n'a produit aucun mouvement de stock
 * et ne doit rien laisser dans l'historique. L'appel est idempotent et refuse
 * catégoriquement de toucher une préparation déjà validée.
 */
export async function cancelPreparation(
  database: SQLiteDatabase,
  preparationId: number,
): Promise<void> {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const preparation = await transaction.getFirstAsync<{ status: string }>(
      'SELECT status FROM preparations WHERE id = ?',
      preparationId,
    );
    if (preparation === null) return;
    if (preparation.status !== 'DRAFT') {
      throw new Error(
        'Cette préparation est déjà terminée : elle ne peut plus être annulée.',
      );
    }
    const movements = await transaction.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM stock_movements WHERE preparation_id = ?',
      preparationId,
    );
    if (movements !== null && movements.count > 0) {
      throw new Error(
        'Des mouvements de stock existent pour cette préparation : annulation refusée.',
      );
    }
    await transaction.runAsync(
      'DELETE FROM preparation_progress WHERE preparation_id = ?',
      preparationId,
    );
    await transaction.runAsync(
      'DELETE FROM preparation_requirements WHERE preparation_id = ?',
      preparationId,
    );
    await transaction.runAsync(
      'DELETE FROM preparation_items WHERE preparation_id = ?',
      preparationId,
    );
    const deleted = await transaction.runAsync(
      `DELETE FROM preparations WHERE id = ? AND status = 'DRAFT'`,
      preparationId,
    );
    if (deleted.changes !== 1) {
      throw new Error('La préparation n’a pas pu être annulée.');
    }
  });
}

/**
 * Valide et consomme une préparation en une transaction exclusive. Toutes les
 * données de lot utiles à l'historique sont copiées au moment de la validation.
 */
export async function completePreparation(
  database: SQLiteDatabase,
  preparationId: number,
  completionDate: string,
): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(completionDate)) {
    throw new Error('La date de validation est invalide.');
  }
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const preparation = await transaction.getFirstAsync<{ status: string }>(
      'SELECT status FROM preparations WHERE id = ?',
      preparationId,
    );
    if (preparation === null) throw new Error('Préparation introuvable.');
    if (preparation.status !== 'DRAFT') {
      throw new Error('Cette préparation est déjà terminée.');
    }

    const requirements = await transaction.getAllAsync<{
      specialty_cis: string;
      specialty_name: string;
      required_half_units: number;
    }>(
      `SELECT specialty_cis, specialty_name, required_half_units
       FROM preparation_requirements WHERE preparation_id = ?
       ORDER BY specialty_name`,
      preparationId,
    );

    for (const requirement of requirements) {
      // Un même médicament peut être couvert par plusieurs boîtes lorsque la
      // première s'est terminée en cours de préparation : chaque ligne de
      // progression est une contribution distincte, décrémentée séparément.
      const usages = await transaction.getAllAsync<{
        box_id: number;
        quantity_half_units: number;
        verification: string;
        box_specialty_cis: string | null;
        presentation_cip13: string | null;
        presentation_label: string | null;
        lot: string | null;
        expiration_date: string | null;
        remaining_quantity: number | null;
      }>(
        `SELECT progress.box_id, progress.quantity_half_units,
          progress.verification,
          box.specialty_cis AS box_specialty_cis,
          box.presentation_cip13, box.presentation_label, box.lot,
          box.expiration_date, box.remaining_quantity
         FROM preparation_progress progress
         LEFT JOIN medication_boxes box ON box.id = progress.box_id
         WHERE progress.preparation_id = ? AND progress.specialty_cis = ?
         ORDER BY progress.box_id`,
        preparationId,
        requirement.specialty_cis,
      );

      if (usages.length === 0) {
        throw new Error(
          'Tous les médicaments doivent être vérifiés avant la validation finale.',
        );
      }

      let coveredHalfUnits = 0;
      for (const usage of usages) {
        if (
          usage.box_specialty_cis === null ||
          usage.presentation_cip13 === null ||
          usage.presentation_label === null ||
          usage.expiration_date === null ||
          usage.remaining_quantity === null
        ) {
          throw new Error(
            'Tous les médicaments doivent être vérifiés avant la validation finale.',
          );
        }
        if (usage.box_specialty_cis !== requirement.specialty_cis) {
          throw new Error(
            'Une boîte vérifiée ne correspond plus au médicament attendu.',
          );
        }
        if (usage.expiration_date < completionDate) {
          throw new Error(
            'Une boîte sélectionnée est périmée. Vérifiez la préparation.',
          );
        }
        const consumedQuantity = usage.quantity_half_units / 2;
        const quantityAfter = usage.remaining_quantity - consumedQuantity;
        if (quantityAfter < 0) {
          throw new Error(
            'Le stock d’une boîte sélectionnée est insuffisant. Rechargez la préparation.',
          );
        }
        const update = await transaction.runAsync(
          `UPDATE medication_boxes
           SET remaining_quantity = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND remaining_quantity = ?`,
          quantityAfter,
          usage.box_id,
          usage.remaining_quantity,
        );
        if (update.changes !== 1) {
          throw new Error(
            'Le stock a changé. Rechargez la préparation puis réessayez.',
          );
        }
        await transaction.runAsync(
          `INSERT INTO stock_movements
            (box_id, preparation_id, type, quantity_delta, quantity_after, explanation)
           VALUES (?, ?, 'PILLBOX_PREPARATION', ?, ?, ?)`,
          usage.box_id,
          preparationId,
          -consumedQuantity,
          quantityAfter,
          `Préparation du pilulier du ${completionDate}`,
        );
        await transaction.runAsync(
          `INSERT INTO preparation_box_usages
            (preparation_id, specialty_cis, specialty_name, box_id,
             presentation_cip13, presentation_label, lot,
             expiration_date, quantity_half_units, verification)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          preparationId,
          requirement.specialty_cis,
          requirement.specialty_name,
          usage.box_id,
          usage.presentation_cip13,
          usage.presentation_label,
          usage.lot,
          usage.expiration_date,
          usage.quantity_half_units,
          toVerificationMethod(usage.verification),
        );
        coveredHalfUnits += usage.quantity_half_units;
      }
      if (coveredHalfUnits !== requirement.required_half_units) {
        throw new Error(
          'La quantité vérifiée ne couvre pas exactement le besoin de la semaine.',
        );
      }
    }

    const completed = await transaction.runAsync(
      `UPDATE preparations
       SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'DRAFT'`,
      preparationId,
    );
    if (completed.changes !== 1) {
      throw new Error('Cette préparation est déjà terminée.');
    }
  });
}

export async function listPreparationHistory(
  database: SQLiteDatabase,
): Promise<PreparationHistoryEntry[]> {
  const preparations = await database.getAllAsync<{
    id: number;
    start_date: string;
    end_date: string;
    completed_at: string;
  }>(
    `SELECT id, start_date, end_date, completed_at FROM preparations
     WHERE status = 'COMPLETED' ORDER BY completed_at DESC, id DESC`,
  );
  const result: PreparationHistoryEntry[] = [];
  for (const preparation of preparations) {
    const medications = await database.getAllAsync<{
      specialty_cis: string;
      specialty_name: string;
      quantity_half_units: number;
      box_id: number;
      presentation_cip13: string;
      presentation_label: string;
      lot: string | null;
      expiration_date: string;
      verification: string;
    }>(
      `SELECT specialty_cis, specialty_name, quantity_half_units, box_id,
        presentation_cip13, presentation_label, lot, expiration_date, verification
       FROM preparation_box_usages WHERE preparation_id = ?
       ORDER BY specialty_name, box_id`,
      preparation.id,
    );
    result.push({
      id: preparation.id,
      startDate: preparation.start_date,
      endDate: preparation.end_date,
      completedAt: preparation.completed_at,
      medications: medications.map((item) => ({
        specialtyCis: item.specialty_cis,
        specialtyName: item.specialty_name,
        quantityHalfUnits: item.quantity_half_units,
        boxId: item.box_id,
        presentationCip13: item.presentation_cip13,
        presentationLabel: item.presentation_label,
        lot: item.lot,
        expirationDate: item.expiration_date,
        verification: toVerificationMethod(item.verification),
      })),
    });
  }
  return result;
}

function toPreparationStatus(value: string): KnownPreparation['status'] {
  if (value !== 'DRAFT' && value !== 'COMPLETED')
    throw new Error(
      'La base locale contient un statut de préparation inconnu.',
    );
  return value;
}

function toVerificationMethod(value: string | null): BoxVerificationMethod {
  if (!(BOX_VERIFICATION_METHODS as readonly (string | null)[]).includes(value))
    throw new Error('La base locale contient une vérification inconnue.');
  return value as BoxVerificationMethod;
}
