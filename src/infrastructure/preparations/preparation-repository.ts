import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';

import type { PreparationSnapshot } from '@/domain/preparations/preparation';

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
