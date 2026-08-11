import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';

import {
  assertValidAsNeededTreatment,
  assertValidTreatmentPhases,
  isIntakeSlot,
  isTreatmentDosageKind,
  isWeekday,
  treatmentPhasesEqual,
  type LegacyDosage,
  type PhaseDosage,
  type Treatment,
  type TreatmentDraft,
  type TreatmentPhase,
} from '@/domain/treatments/treatment';

type TreatmentRow = {
  id: number;
  specialty_cis: string;
  specialty_name: string;
  pharmaceutical_form: string | null;
  dosage_kind: string;
  included_in_pillbox: number;
  archived_at: string | null;
  as_needed_max_quantity_half_units: number | null;
  as_needed_min_interval_hours: number | null;
};

type PhaseRow = {
  id: number;
  treatment_id: number;
  start_date: string | null;
  end_date: string | null;
  frequency_type: string;
  interval_days: number | null;
  anchor_date: string | null;
  weekly_weekday: string | null;
};

type PhaseDosageRow = {
  phase_id: number;
  weekday: string;
  slot: string;
  quantity_half_units: number;
};

export async function listTreatments(
  database: SQLiteDatabase,
): Promise<Treatment[]> {
  const rows = await database.getAllAsync<TreatmentRow>(
    `${TREATMENT_SELECT} ORDER BY archived_at IS NOT NULL, specialty_name`,
  );
  return hydrateTreatments(database, rows);
}

export type TreatmentRemovalAction = 'DELETE' | 'ARCHIVE';

export async function getTreatmentRemovalAction(
  database: SQLiteDatabase,
  treatmentId: number,
): Promise<TreatmentRemovalAction> {
  // Une ligne `UNSET` dans intake_records n'est qu'un aide-mémoire de
  // planification matérialisé par la synchronisation des rappels (jusqu'à
  // 30 jours à l'avance) : elle ne prouve aucune prise réelle et ne doit pas
  // empêcher la suppression d'un traitement jamais réellement pris ni
  // ignoré. Seules les lignes TAKEN/SKIPPED comptent comme un usage réel.
  const row = await database.getFirstAsync<{ used: number }>(
    `SELECT EXISTS(
       SELECT 1 FROM preparation_items WHERE source_treatment_id = ?
       UNION ALL
       SELECT 1 FROM intake_records WHERE source_treatment_id = ? AND status <> 'UNSET'
       UNION ALL
       SELECT 1 FROM as_needed_intake_records WHERE treatment_id = ?
     ) AS used`,
    treatmentId,
    treatmentId,
    treatmentId,
  );
  return row?.used === 1 ? 'ARCHIVE' : 'DELETE';
}

export async function deleteUnusedTreatment(
  database: SQLiteDatabase,
  treatmentId: number,
): Promise<void> {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    if (
      (await getTreatmentRemovalAction(transaction, treatmentId)) === 'ARCHIVE'
    )
      throw new Error(
        'Ce traitement a déjà été utilisé et ne peut pas être supprimé définitivement.',
      );
    // intake_records n'a pas de clé étrangère vers treatments (une prise
    // réelle doit survivre à la suppression de son traitement, comme
    // preparation_items) : les lignes UNSET restantes, simples aide-mémoire
    // de planification jamais transformés en prise réelle, sont donc
    // supprimées explicitement pour ne rien laisser d'orphelin.
    await transaction.runAsync(
      `DELETE FROM intake_records WHERE source_treatment_id = ? AND status = 'UNSET'`,
      treatmentId,
    );
    const result = await transaction.runAsync(
      'DELETE FROM treatments WHERE id = ?',
      treatmentId,
    );
    if (result.changes !== 1) throw new Error('Traitement introuvable.');
  });
}

export async function archiveTreatment(
  database: SQLiteDatabase,
  treatmentId: number,
): Promise<void> {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    if (
      (await getTreatmentRemovalAction(transaction, treatmentId)) !== 'ARCHIVE'
    )
      throw new Error(
        'Ce traitement n’a jamais été utilisé et doit être supprimé définitivement.',
      );
    const result = await transaction.runAsync(
      `UPDATE treatments SET active = 0,
       archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND archived_at IS NULL`,
      treatmentId,
    );
    if (result.changes !== 1)
      throw new Error('Traitement introuvable ou déjà archivé.');
    await transaction.runAsync(
      `INSERT INTO treatment_lifecycle_events (treatment_id, event_type) VALUES (?, 'ARCHIVED')`,
      treatmentId,
    );
  });
}

export async function restoreArchivedTreatment(
  database: SQLiteDatabase,
  treatmentId: number,
): Promise<void> {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const result = await transaction.runAsync(
      `UPDATE treatments SET active = 1, archived_at = NULL,
       updated_at = CURRENT_TIMESTAMP WHERE id = ? AND archived_at IS NOT NULL`,
      treatmentId,
    );
    if (result.changes !== 1)
      throw new Error('Traitement introuvable ou non archivé.');
    await transaction.runAsync(
      `INSERT INTO treatment_lifecycle_events (treatment_id, event_type) VALUES (?, 'REACTIVATED')`,
      treatmentId,
    );
  });
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
       (specialty_cis, specialty_name, pharmaceutical_form, dosage_kind, included_in_pillbox,
        as_needed_max_quantity_half_units, as_needed_min_interval_hours)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      draft.specialtyCis,
      draft.specialtyName,
      draft.pharmaceuticalForm,
      draft.dosageKind,
      draft.includedInPillbox ? 1 : 0,
      draft.asNeededInfo.maxQuantityPerDayHalfUnits,
      draft.asNeededInfo.minIntervalHours,
    );
    await insertPhases(transaction, result.lastInsertRowId, draft.phases);
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
    const existing = await getTreatment(transaction, treatment.id);
    const result = await transaction.runAsync(
      `UPDATE treatments SET specialty_cis = ?, specialty_name = ?, pharmaceutical_form = ?,
       dosage_kind = ?, included_in_pillbox = ?, as_needed_max_quantity_half_units = ?,
       as_needed_min_interval_hours = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      treatment.specialtyCis,
      treatment.specialtyName,
      treatment.pharmaceuticalForm,
      treatment.dosageKind,
      treatment.includedInPillbox ? 1 : 0,
      treatment.asNeededInfo.maxQuantityPerDayHalfUnits,
      treatment.asNeededInfo.minIntervalHours,
      treatment.id,
    );
    if (result.changes !== 1) throw new Error('Traitement introuvable.');
    await transaction.runAsync(
      `DELETE FROM treatment_phase_dosages
       WHERE phase_id IN (SELECT id FROM treatment_phases WHERE treatment_id = ?)`,
      treatment.id,
    );
    await transaction.runAsync(
      'DELETE FROM treatment_phases WHERE treatment_id = ?',
      treatment.id,
    );
    await insertPhases(transaction, treatment.id, treatment.phases);
    // Remplacer les phases efface leur trace dans treatment_phases : sans ce
    // marqueur, la timeline (ticket 18) perdrait la date à laquelle une
    // posologie a réellement changé. Un enregistrement sans changement de
    // posologie (autre champ modifié) ne doit rien journaliser.
    if (
      existing !== null &&
      !treatmentPhasesEqual(existing.phases, treatment.phases)
    ) {
      await transaction.runAsync(
        `INSERT INTO treatment_lifecycle_events (treatment_id, event_type) VALUES (?, 'DOSAGE_MODIFIED')`,
        treatment.id,
      );
    }
  });
}

async function insertPhases(
  database: SQLiteDatabase,
  treatmentId: number,
  phases: readonly TreatmentPhase[],
): Promise<void> {
  for (const [position, phase] of phases.entries()) {
    const frequency = phase.frequency;
    const result = await database.runAsync(
      `INSERT INTO treatment_phases
       (treatment_id, position, start_date, end_date, frequency_type, interval_days, anchor_date, weekly_weekday)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      treatmentId,
      position,
      phase.startDate,
      phase.endDate,
      frequency.type === 'legacy-weekdays' ? 'legacy_weekdays' : frequency.type,
      frequency.type === 'interval' ? frequency.everyNDays : null,
      frequency.type === 'interval' ? frequency.anchorDate : null,
      frequency.type === 'weekly' ? frequency.weekday : null,
    );
    for (const dosage of phase.dosage) {
      await database.runAsync(
        `INSERT INTO treatment_phase_dosages (phase_id, weekday, slot, quantity_half_units)
         VALUES (?, ?, ?, ?)`,
        result.lastInsertRowId,
        'weekday' in dosage ? dosage.weekday : '',
        dosage.slot,
        dosage.quantityHalfUnits,
      );
    }
  }
}

async function hydrateTreatments(
  database: SQLiteDatabase,
  rows: readonly TreatmentRow[],
): Promise<Treatment[]> {
  if (rows.length === 0) return [];
  const placeholders = rows.map(() => '?').join(', ');
  const phaseRows = await database.getAllAsync<PhaseRow>(
    `SELECT id, treatment_id, start_date, end_date, frequency_type, interval_days,
      anchor_date, weekly_weekday FROM treatment_phases
     WHERE treatment_id IN (${placeholders}) ORDER BY treatment_id, position`,
    ...rows.map((row) => row.id),
  );
  const phaseIds = phaseRows.map((row) => row.id);
  const dosageRows =
    phaseIds.length === 0
      ? []
      : await database.getAllAsync<PhaseDosageRow>(
          `SELECT phase_id, weekday, slot, quantity_half_units FROM treatment_phase_dosages
     WHERE phase_id IN (${phaseIds.map(() => '?').join(', ')}) ORDER BY phase_id, weekday, slot`,
          ...phaseIds,
        );
  const dosageByPhase = new Map<number, PhaseDosageRow[]>();
  for (const row of dosageRows) {
    if (!isIntakeSlot(row.slot))
      throw new Error('La base locale contient un créneau invalide.');
    const dosage = dosageByPhase.get(row.phase_id) ?? [];
    dosage.push(row);
    dosageByPhase.set(row.phase_id, dosage);
  }
  const phasesByTreatment = new Map<number, TreatmentPhase[]>();
  for (const row of phaseRows) {
    const rawDosage = dosageByPhase.get(row.id) ?? [];
    let phase: TreatmentPhase;
    if (row.frequency_type === 'legacy_weekdays') {
      const dosage: LegacyDosage[] = rawDosage.map((item) => {
        if (!isWeekday(item.weekday))
          throw new Error('La base locale contient un jour invalide.');
        return {
          weekday: item.weekday,
          slot: item.slot as LegacyDosage['slot'],
          quantityHalfUnits: item.quantity_half_units,
        };
      });
      phase = {
        id: row.id,
        startDate: null,
        endDate: null,
        frequency: { type: 'legacy-weekdays' },
        dosage,
      };
    } else {
      if (row.start_date === null)
        throw new Error('La base locale contient une phase sans début.');
      const dosage: PhaseDosage[] = rawDosage.map((item) => ({
        slot: item.slot as PhaseDosage['slot'],
        quantityHalfUnits: item.quantity_half_units,
      }));
      if (row.frequency_type === 'daily')
        phase = {
          id: row.id,
          startDate: row.start_date,
          endDate: row.end_date,
          frequency: { type: 'daily' },
          dosage,
        };
      else if (
        row.frequency_type === 'interval' &&
        row.interval_days !== null &&
        row.anchor_date !== null
      )
        phase = {
          id: row.id,
          startDate: row.start_date,
          endDate: row.end_date,
          frequency: {
            type: 'interval',
            everyNDays: row.interval_days,
            anchorDate: row.anchor_date,
          },
          dosage,
        };
      else if (
        row.frequency_type === 'weekly' &&
        row.weekly_weekday !== null &&
        isWeekday(row.weekly_weekday)
      )
        phase = {
          id: row.id,
          startDate: row.start_date,
          endDate: row.end_date,
          frequency: { type: 'weekly', weekday: row.weekly_weekday },
          dosage,
        };
      else throw new Error('La base locale contient une fréquence invalide.');
    }
    const phases = phasesByTreatment.get(row.treatment_id) ?? [];
    phases.push(phase);
    phasesByTreatment.set(row.treatment_id, phases);
  }
  return rows.map((row) => {
    if (!isTreatmentDosageKind(row.dosage_kind))
      throw new Error(
        'La base locale contient un type de traitement invalide.',
      );
    return {
      id: row.id,
      specialtyCis: row.specialty_cis,
      specialtyName: row.specialty_name,
      pharmaceuticalForm: row.pharmaceutical_form,
      dosageKind: row.dosage_kind,
      includedInPillbox: row.included_in_pillbox === 1,
      archivedAt: row.archived_at,
      phases: phasesByTreatment.get(row.id) ?? [],
      asNeededInfo: {
        maxQuantityPerDayHalfUnits: row.as_needed_max_quantity_half_units,
        minIntervalHours: row.as_needed_min_interval_hours,
      },
    };
  });
}

function validateDraft(draft: TreatmentDraft): void {
  if (draft.specialtyCis.trim() === '' || draft.specialtyName.trim() === '')
    throw new Error('La spécialité doit provenir du référentiel.');
  if (draft.dosageKind === 'AS_NEEDED') assertValidAsNeededTreatment(draft);
  else assertValidTreatmentPhases(draft.phases);
}

const TREATMENT_SELECT = `SELECT id, specialty_cis, specialty_name, pharmaceutical_form, dosage_kind,
  included_in_pillbox, archived_at, as_needed_max_quantity_half_units, as_needed_min_interval_hours
  FROM treatments`;
