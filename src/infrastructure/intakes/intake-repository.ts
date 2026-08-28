import type { SQLiteDatabase } from 'expo-sqlite';

import {
  isIntakeStatus,
  PENDING_INTAKE_STATUS,
  type IntakeGroupKey,
  type IntakeRecord,
  type IntakeStatus,
  type PendingIntakeCount,
} from '@/domain/intakes/intake-tracking';
import { isExpired } from '@/domain/inventory/inventory';
import { isIntakeSlot, type IntakeSlot } from '@/domain/treatments/treatment';

type IntakeRow = {
  intake_key: string;
  source_treatment_id: number;
  intake_date: string;
  slot: string;
  specialty_cis: string;
  specialty_name: string;
  pharmaceutical_form: string | null;
  quantity_half_units: number;
  status: string;
  created_at: string;
  updated_at: string;
};

export type IntakeSnapshot = Omit<
  IntakeRecord,
  'status' | 'createdAt' | 'updatedAt'
>;

/**
 * Matérialise les prochaines prises à partir de la posologie source.
 *
 * Une prise déjà matérialisée mais encore `UNSET` n'a fait l'objet d'aucune
 * décision : si la posologie a changé depuis, ses champs dérivés sont mis à
 * jour. Une prise `TAKEN` ou `SKIPPED` traduit une décision explicite de
 * l'utilisatrice ; elle n'est jamais réécrite, quelle que soit la posologie
 * source au moment du recalcul.
 */
export async function materializeIntakeSnapshots(
  database: SQLiteDatabase,
  snapshots: readonly IntakeSnapshot[],
): Promise<void> {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    for (const snapshot of snapshots) {
      await transaction.runAsync(
        `INSERT INTO intake_records
         (intake_key, source_treatment_id, intake_date, slot, specialty_cis,
          specialty_name, pharmaceutical_form, quantity_half_units)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(intake_key) DO UPDATE SET
           specialty_name = excluded.specialty_name,
           pharmaceutical_form = excluded.pharmaceutical_form,
           quantity_half_units = excluded.quantity_half_units,
           updated_at = CURRENT_TIMESTAMP
         WHERE intake_records.status = 'UNSET'`,
        snapshot.key,
        snapshot.treatmentId,
        snapshot.date,
        snapshot.slot,
        snapshot.specialtyCis,
        snapshot.specialtyName,
        snapshot.pharmaceuticalForm,
        snapshot.quantityHalfUnits,
      );
    }
  });
}

export async function listIntakeRecordsForGroups(
  database: SQLiteDatabase,
  date: string,
  slots: readonly IntakeSlot[],
): Promise<IntakeRecord[]> {
  if (slots.length === 0) return [];
  const rows = await database.getAllAsync<IntakeRow>(
    `SELECT * FROM intake_records WHERE intake_date = ?
     AND slot IN (${slots.map(() => '?').join(', ')})
     ORDER BY slot, specialty_name, source_treatment_id`,
    date,
    ...slots,
  );
  return rows.map(hydrateIntake);
}

export type IntakeHistoryFilters = Readonly<{
  startDate: string | null;
  endDate: string;
  treatmentId: number | null;
}>;

export async function listIntakeHistory(
  database: SQLiteDatabase,
  filters: IntakeHistoryFilters,
): Promise<IntakeRecord[]> {
  const conditions = ['intake_date <= ?'];
  const parameters: (string | number)[] = [filters.endDate];
  if (filters.startDate !== null) {
    conditions.push('intake_date >= ?');
    parameters.push(filters.startDate);
  }
  if (filters.treatmentId !== null) {
    conditions.push('source_treatment_id = ?');
    parameters.push(filters.treatmentId);
  }
  const rows = await database.getAllAsync<IntakeRow>(
    `SELECT * FROM intake_records WHERE ${conditions.join(' AND ')}
     ORDER BY intake_date DESC, slot DESC, specialty_name`,
    ...parameters,
  );
  return rows.map(hydrateIntake);
}

export async function updateIntakeStatus(
  database: SQLiteDatabase,
  intakeKey: string,
  status: IntakeStatus,
): Promise<void> {
  if (!isIntakeStatus(status)) throw new Error('Statut de prise invalide.');
  const record = await database.getFirstAsync<{
    dosage_kind: string;
    included_in_pillbox: number;
    has_stock_consumption: number;
  }>(
    `SELECT treatment.dosage_kind, treatment.included_in_pillbox,
      EXISTS(
        SELECT 1 FROM stock_movements
        WHERE intake_key = intake_records.intake_key
      ) AS has_stock_consumption
     FROM intake_records
     LEFT JOIN treatments treatment ON treatment.id = intake_records.source_treatment_id
     WHERE intake_records.intake_key = ?`,
    intakeKey,
  );
  if (record === null) throw new Error('Prise prévue introuvable.');
  if (
    status === 'TAKEN' &&
    record.dosage_kind === 'SCHEDULED' &&
    record.included_in_pillbox === 0
  ) {
    throw new Error(
      'Choisissez la boîte utilisée avant de marquer cette prise comme prise.',
    );
  }
  if (record.has_stock_consumption === 1 && status !== 'TAKEN') {
    throw new Error(
      'Cette prise a déjà décrémenté le stock : elle ne peut plus être modifiée.',
    );
  }
  const result = await database.runAsync(
    `UPDATE intake_records SET status = ?, updated_at = CURRENT_TIMESTAMP
     WHERE intake_key = ?`,
    status,
    intakeKey,
  );
  if (result.changes !== 1) throw new Error('Prise prévue introuvable.');
}

/**
 * Valide une prise planifiée hors pilulier et consomme, dans la même
 * transaction, le lot explicitement choisi. La relation unique entre le
 * mouvement et la prise empêche toute double décrémentation.
 */
export async function takeOutsidePillboxIntake(
  database: SQLiteDatabase,
  intakeKey: string,
  boxId: number,
  today: string,
): Promise<void> {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const intake = await transaction.getFirstAsync<{
      source_treatment_id: number;
      specialty_cis: string;
      specialty_name: string;
      quantity_half_units: number;
      status: string;
      dosage_kind: string;
      included_in_pillbox: number;
    }>(
      `SELECT intake.source_treatment_id, intake.specialty_cis, intake.specialty_name,
        intake.quantity_half_units, intake.status, treatment.dosage_kind,
        treatment.included_in_pillbox
       FROM intake_records intake
       JOIN treatments treatment ON treatment.id = intake.source_treatment_id
       WHERE intake.intake_key = ?`,
      intakeKey,
    );
    if (intake === null) throw new Error('Prise prévue introuvable.');
    if (intake.dosage_kind !== 'SCHEDULED' || intake.included_in_pillbox !== 0)
      throw new Error(
        'Cette prise ne nécessite pas de consommation hors pilulier.',
      );
    if (intake.status !== 'UNSET')
      throw new Error('Cette prise est déjà renseignée.');

    const box = await transaction.getFirstAsync<{
      specialty_cis: string;
      expiration_date: string;
      remaining_quantity: number;
    }>(
      `SELECT specialty_cis, expiration_date, remaining_quantity
       FROM medication_boxes WHERE id = ?`,
      boxId,
    );
    if (box === null) throw new Error('Boîte introuvable.');
    const accepted =
      box.specialty_cis === intake.specialty_cis ||
      (await transaction.getFirstAsync<{ found: number }>(
        `SELECT 1 AS found FROM generic_equivalence_confirmations
         WHERE treatment_id = ? AND cis = ?`,
        intake.source_treatment_id,
        box.specialty_cis,
      )) !== null;
    if (!accepted)
      throw new Error('Cette boîte ne correspond pas au traitement.');
    if (isExpired(box.expiration_date, today))
      throw new Error('Une boîte périmée ne peut pas être utilisée.');

    const quantity = intake.quantity_half_units / 2;
    if (box.remaining_quantity < quantity)
      throw new Error('Le stock de cette boîte est insuffisant.');
    const quantityAfter = box.remaining_quantity - quantity;
    const updated = await transaction.runAsync(
      `UPDATE medication_boxes
       SET remaining_quantity = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND remaining_quantity = ?`,
      quantityAfter,
      boxId,
      box.remaining_quantity,
    );
    if (updated.changes !== 1)
      throw new Error('Le stock a changé. Rechargez puis réessayez.');
    const status = await transaction.runAsync(
      `UPDATE intake_records SET status = 'TAKEN', updated_at = CURRENT_TIMESTAMP
       WHERE intake_key = ? AND status = 'UNSET'`,
      intakeKey,
    );
    if (status.changes !== 1)
      throw new Error('Cette prise est déjà renseignée.');
    await transaction.runAsync(
      `INSERT INTO stock_movements
       (box_id, intake_key, type, quantity_delta, quantity_after, explanation)
       VALUES (?, ?, 'OUTSIDE_PILLBOX_INTAKE', ?, ?, ?)`,
      boxId,
      intakeKey,
      -quantity,
      quantityAfter,
      `Prise hors pilulier : ${intake.specialty_name}`,
    );
  });
}

/**
 * Valide en une seule opération les médicaments encore en attente d'un
 * créneau, sans toucher à ceux déjà renseignés.
 * Retourne le nombre de prises réellement validées.
 */
export async function markPendingIntakesTaken(
  database: SQLiteDatabase,
  date: string,
  slot: IntakeSlot,
): Promise<number> {
  return markPendingIntakesTakenForGroups(database, [{ date, slot }]);
}

/**
 * Même validation, étendue à plusieurs créneaux traités ensemble : c'est le cas
 * d'un rappel qui couvre deux créneaux programmés à la même heure.
 *
 * L'horodatage est lu une seule fois dans la transaction puis appliqué tel quel
 * à chaque instruction, de sorte que toutes les prises validées ensemble
 * portent la même heure de validation. La condition `status = 'UNSET'` rend
 * l'opération idempotente : rejouer la même action ne revalide rien et ne
 * réécrit pas l'heure des prises déjà renseignées.
 */
export async function markPendingIntakesTakenForGroups(
  database: SQLiteDatabase,
  groups: readonly IntakeGroupKey[],
): Promise<number> {
  const unique = [
    ...new Map(
      groups.map((group) => [`${group.date}:${group.slot}`, group]),
    ).values(),
  ];
  if (unique.length === 0) return 0;
  let validated = 0;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const stamp = await transaction.getFirstAsync<{ value: string }>(
      'SELECT CURRENT_TIMESTAMP AS value',
    );
    if (stamp === null)
      throw new Error('Validation impossible : horodatage indisponible.');
    let total = 0;
    for (const group of unique) {
      const result = await transaction.runAsync(
        `UPDATE intake_records SET status = 'TAKEN', updated_at = ?
         WHERE intake_date = ? AND slot = ? AND status = ?
           AND NOT EXISTS (
             SELECT 1 FROM treatments
             WHERE treatments.id = intake_records.source_treatment_id
               AND treatments.dosage_kind = 'SCHEDULED'
               AND treatments.included_in_pillbox = 0
           )`,
        stamp.value,
        group.date,
        group.slot,
        PENDING_INTAKE_STATUS,
      );
      total += result.changes;
    }
    validated = total;
  });
  return validated;
}

/**
 * Prises encore en attente, regroupées par créneau, sur une période. Sert à
 * choisir le libellé de l'action rapide au moment de programmer un rappel.
 */
export async function listPendingIntakeCounts(
  database: SQLiteDatabase,
  startDate: string,
  endDate: string,
): Promise<PendingIntakeCount[]> {
  const rows = await database.getAllAsync<{
    intake_date: string;
    slot: string;
    pending: number;
  }>(
    `SELECT intake_date, slot, COUNT(*) AS pending FROM intake_records
     WHERE status = ? AND intake_date BETWEEN ? AND ?
     GROUP BY intake_date, slot`,
    PENDING_INTAKE_STATUS,
    startDate,
    endDate,
  );
  return rows.map((row) => {
    if (!isIntakeSlot(row.slot))
      throw new Error('La base locale contient un créneau invalide.');
    return { date: row.intake_date, slot: row.slot, pending: row.pending };
  });
}

export type IntakePostponement = Readonly<{
  date: string;
  slot: IntakeSlot;
  scheduledAt: string;
  notificationId: string | null;
}>;

export async function getIntakePostponement(
  database: SQLiteDatabase,
  date: string,
  slot: IntakeSlot,
): Promise<IntakePostponement | null> {
  const row = await database.getFirstAsync<{
    intake_date: string;
    slot: string;
    scheduled_at: string;
    notification_id: string | null;
  }>(
    `SELECT intake_date, slot, scheduled_at, notification_id
     FROM intake_postponements WHERE intake_date = ? AND slot = ?`,
    date,
    slot,
  );
  if (!row) return null;
  if (!isIntakeSlot(row.slot))
    throw new Error('La base locale contient un créneau invalide.');
  return {
    date: row.intake_date,
    slot: row.slot,
    scheduledAt: row.scheduled_at,
    notificationId: row.notification_id,
  };
}

export async function listIntakePostponements(
  database: SQLiteDatabase,
): Promise<IntakePostponement[]> {
  const rows = await database.getAllAsync<{
    intake_date: string;
    slot: string;
    scheduled_at: string;
    notification_id: string | null;
  }>(
    'SELECT intake_date, slot, scheduled_at, notification_id FROM intake_postponements',
  );
  return rows.map((row) => {
    if (!isIntakeSlot(row.slot))
      throw new Error('La base locale contient un créneau invalide.');
    return {
      date: row.intake_date,
      slot: row.slot,
      scheduledAt: row.scheduled_at,
      notificationId: row.notification_id,
    };
  });
}

export async function saveIntakePostponement(
  database: SQLiteDatabase,
  value: IntakePostponement,
): Promise<void> {
  await database.runAsync(
    `INSERT INTO intake_postponements
     (intake_date, slot, scheduled_at, notification_id) VALUES (?, ?, ?, ?)
     ON CONFLICT(intake_date, slot) DO UPDATE SET
       scheduled_at = excluded.scheduled_at,
       notification_id = excluded.notification_id,
       updated_at = CURRENT_TIMESTAMP`,
    value.date,
    value.slot,
    value.scheduledAt,
    value.notificationId,
  );
}

export async function deleteIntakePostponement(
  database: SQLiteDatabase,
  date: string,
  slot: IntakeSlot,
): Promise<void> {
  await database.runAsync(
    'DELETE FROM intake_postponements WHERE intake_date = ? AND slot = ?',
    date,
    slot,
  );
}

function hydrateIntake(row: IntakeRow): IntakeRecord {
  if (!isIntakeSlot(row.slot) || !isIntakeStatus(row.status))
    throw new Error('La base locale contient une prise invalide.');
  return {
    key: row.intake_key,
    treatmentId: row.source_treatment_id,
    date: row.intake_date,
    slot: row.slot,
    specialtyCis: row.specialty_cis,
    specialtyName: row.specialty_name,
    pharmaceuticalForm: row.pharmaceutical_form,
    quantityHalfUnits: row.quantity_half_units,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
