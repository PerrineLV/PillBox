import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';

import type { PreparationSnapshot } from '@/domain/preparations/preparation';

export type SavedPreparationProgress = Readonly<{
  specialtyCis: string;
  boxId: number;
  scanRaw: string;
  nonFefoAcknowledged: boolean;
}>;

export type SavedPreparation = Readonly<{
  id: number;
  snapshot: PreparationSnapshot;
  progress: readonly SavedPreparationProgress[];
}>;

/** Persiste uniquement un nouveau snapshot ; aucune mise à jour de son contenu n'est exposée. */
export async function createPreparation(
  database: SQLiteDatabase,
  snapshot: PreparationSnapshot,
): Promise<number> {
  let insert: SQLiteRunResult | null = null;
  await database.withExclusiveTransactionAsync(async (transaction) => {
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
    scan_raw: string;
    non_fefo_acknowledged: number;
  }>(
    `SELECT specialty_cis, box_id, scan_raw, non_fefo_acknowledged
     FROM preparation_progress WHERE preparation_id = ?`,
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
      scanRaw: row.scan_raw,
      nonFefoAcknowledged: row.non_fefo_acknowledged === 1,
    })),
  };
}

export async function savePreparationProgress(
  database: SQLiteDatabase,
  preparationId: number,
  progress: SavedPreparationProgress,
): Promise<void> {
  await database.runAsync(
    `INSERT INTO preparation_progress
      (preparation_id, specialty_cis, box_id, scan_raw, non_fefo_acknowledged)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(preparation_id, specialty_cis) DO UPDATE SET
       box_id = excluded.box_id,
       scan_raw = excluded.scan_raw,
       non_fefo_acknowledged = excluded.non_fefo_acknowledged,
       completed_at = CURRENT_TIMESTAMP`,
    preparationId,
    progress.specialtyCis,
    progress.boxId,
    progress.scanRaw,
    progress.nonFefoAcknowledged ? 1 : 0,
  );
}
