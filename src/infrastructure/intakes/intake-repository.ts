import type { SQLiteDatabase } from 'expo-sqlite';

import {
  isIntakeStatus,
  PENDING_INTAKE_STATUS,
  type IntakeGroupKey,
  type IntakeRecord,
  type IntakeStatus,
  type PendingIntakeCount,
} from '@/domain/intakes/intake-tracking';
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

export async function materializeIntakeSnapshots(
  database: SQLiteDatabase,
  snapshots: readonly IntakeSnapshot[],
): Promise<void> {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    for (const snapshot of snapshots) {
      await transaction.runAsync(
        `INSERT OR IGNORE INTO intake_records
         (intake_key, source_treatment_id, intake_date, slot, specialty_cis,
          specialty_name, pharmaceutical_form, quantity_half_units)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
  const result = await database.runAsync(
    `UPDATE intake_records SET status = ?, updated_at = CURRENT_TIMESTAMP
     WHERE intake_key = ?`,
    status,
    intakeKey,
  );
  if (result.changes !== 1) throw new Error('Prise prévue introuvable.');
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
         WHERE intake_date = ? AND slot = ? AND status = ?`,
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
