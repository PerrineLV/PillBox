import type { SQLiteDatabase } from 'expo-sqlite';

import {
  buildTimeline,
  type TimelineEvent,
  type TimelineIntakeSource,
  type TimelineLifecycleEventSource,
  type TimelinePreparationSource,
  type TimelineStockMovementSource,
  type TimelineTreatmentSource,
} from '@/domain/history/timeline';
import { isIntakeSlot } from '@/domain/treatments/treatment';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';

export type TimelineQueryFilters = Readonly<{
  /** `null` charge la timeline de tous les traitements. */
  treatmentId: number | null;
  /** Date civile `YYYY-MM-DD` ; `null` = pas de borne basse. */
  startDate: string | null;
}>;

/**
 * Charge les données nécessaires à la timeline pour un ou tous les
 * traitements et les assemble via la fonction métier pure `buildTimeline`.
 * Chaque source reste un snapshot déjà persisté : aucune requête ne recalcule
 * une posologie ou une quantité à partir de l'état courant du traitement.
 */
export async function listTimelineEvents(
  database: SQLiteDatabase,
  filters: TimelineQueryFilters,
): Promise<TimelineEvent[]> {
  const treatments = await listTreatments(database);
  const relevantTreatments =
    filters.treatmentId === null
      ? treatments
      : treatments.filter((treatment) => treatment.id === filters.treatmentId);
  if (relevantTreatments.length === 0) return [];

  const ids = relevantTreatments.map((treatment) => treatment.id);
  const placeholders = ids.map(() => '?').join(', ');
  const startDate = filters.startDate;
  const startDateParameters = startDate === null ? [] : [startDate];

  const createdAtRows = await database.getAllAsync<{
    id: number;
    created_at: string;
  }>(
    `SELECT id, created_at FROM treatments WHERE id IN (${placeholders})`,
    ...ids,
  );
  const createdAtById = new Map(
    createdAtRows.map((row) => [row.id, row.created_at]),
  );

  const treatmentSources: TimelineTreatmentSource[] = relevantTreatments.map(
    (treatment) => ({
      id: treatment.id,
      specialtyName: treatment.specialtyName,
      createdAt: createdAtById.get(treatment.id) ?? '',
      phases: treatment.phases,
    }),
  );

  const lifecycleRows = await database.getAllAsync<{
    treatment_id: number;
    event_type: string;
    occurred_at: string;
  }>(
    `SELECT treatment_id, event_type, occurred_at FROM treatment_lifecycle_events
     WHERE treatment_id IN (${placeholders})
     ${startDate === null ? '' : 'AND occurred_at >= ?'}
     ORDER BY occurred_at`,
    ...ids,
    ...startDateParameters,
  );
  const lifecycleEvents: TimelineLifecycleEventSource[] = lifecycleRows.map(
    (row) => {
      if (
        row.event_type !== 'ARCHIVED' &&
        row.event_type !== 'REACTIVATED' &&
        row.event_type !== 'DOSAGE_MODIFIED'
      )
        throw new Error(
          'La base locale contient un événement de traitement inconnu.',
        );
      return {
        treatmentId: row.treatment_id,
        type: row.event_type,
        occurredAt: row.occurred_at,
      };
    },
  );

  const preparationRows = await database.getAllAsync<{
    treatment_id: number;
    preparation_id: number;
    start_date: string;
    end_date: string;
    completed_at: string;
    box_id: number | null;
    lot: string | null;
    expiration_date: string | null;
    presentation_label: string | null;
    quantity_half_units: number | null;
    matched_cis: string | null;
    matched_specialty_name: string | null;
  }>(
    `SELECT items.source_treatment_id AS treatment_id, prep.id AS preparation_id,
      prep.start_date, prep.end_date, prep.completed_at,
      usage.box_id, usage.lot, usage.expiration_date, usage.presentation_label,
      usage.quantity_half_units, usage.matched_cis, usage.matched_specialty_name
     FROM (SELECT DISTINCT preparation_id, source_treatment_id, specialty_cis
           FROM preparation_items) items
     JOIN preparations prep ON prep.id = items.preparation_id AND prep.status = 'COMPLETED'
     LEFT JOIN preparation_box_usages usage
       ON usage.preparation_id = items.preparation_id
      AND usage.specialty_cis = items.specialty_cis
     WHERE items.source_treatment_id IN (${placeholders})
     ${startDate === null ? '' : 'AND prep.completed_at >= ?'}
     ORDER BY prep.completed_at, usage.box_id`,
    ...ids,
    ...startDateParameters,
  );
  const preparations: TimelinePreparationSource[] = preparationRows.map(
    (row) => ({
      treatmentId: row.treatment_id,
      preparationId: row.preparation_id,
      startDate: row.start_date,
      endDate: row.end_date,
      completedAt: row.completed_at,
      boxId: row.box_id,
      lot: row.lot,
      expirationDate: row.expiration_date,
      presentationLabel: row.presentation_label,
      quantityHalfUnits: row.quantity_half_units,
      matchedCis: row.matched_cis,
      matchedSpecialtyName: row.matched_specialty_name,
    }),
  );

  const movementRows = await database.getAllAsync<{
    treatment_id: number;
    id: number;
    type: string;
    quantity_delta: number;
    explanation: string;
    created_at: string;
    specialty_name: string;
  }>(
    `SELECT t.id AS treatment_id, sm.id, sm.type, sm.quantity_delta,
      sm.explanation, sm.created_at, box.specialty_name
     FROM stock_movements sm
     JOIN medication_boxes box ON box.id = sm.box_id
     JOIN treatments t ON t.specialty_cis = box.specialty_cis
     WHERE sm.type <> 'PILLBOX_PREPARATION' AND t.id IN (${placeholders})
     ${startDate === null ? '' : 'AND sm.created_at >= ?'}
     ORDER BY sm.created_at`,
    ...ids,
    ...startDateParameters,
  );
  const stockMovements: TimelineStockMovementSource[] = movementRows.map(
    (row) => {
      if (
        row.type !== 'BOX_ADDED' &&
        row.type !== 'MANUAL_ADJUSTMENT' &&
        row.type !== 'CORRECTION'
      )
        throw new Error(
          'La base locale contient un mouvement de stock inconnu.',
        );
      return {
        treatmentId: row.treatment_id,
        id: row.id,
        type: row.type,
        quantityDelta: row.quantity_delta,
        explanation: row.explanation,
        createdAt: row.created_at,
        specialtyName: row.specialty_name,
      };
    },
  );

  const intakeRows = await database.getAllAsync<{
    treatment_id: number;
    intake_key: string;
    intake_date: string;
    slot: string;
    status: string;
    quantity_half_units: number;
    updated_at: string;
    specialty_name: string;
  }>(
    `SELECT source_treatment_id AS treatment_id, intake_key, intake_date, slot,
      status, quantity_half_units, updated_at, specialty_name
     FROM intake_records
     WHERE status <> 'UNSET' AND source_treatment_id IN (${placeholders})
     ${startDate === null ? '' : 'AND updated_at >= ?'}
     ORDER BY updated_at`,
    ...ids,
    ...startDateParameters,
  );
  const intakeRecords: TimelineIntakeSource[] = intakeRows.map((row) => {
    if (!isIntakeSlot(row.slot))
      throw new Error('La base locale contient un créneau invalide.');
    if (row.status !== 'TAKEN' && row.status !== 'SKIPPED')
      throw new Error('La base locale contient un statut de prise invalide.');
    return {
      treatmentId: row.treatment_id,
      key: row.intake_key,
      date: row.intake_date,
      slot: row.slot,
      status: row.status,
      quantityHalfUnits: row.quantity_half_units,
      updatedAt: row.updated_at,
      specialtyName: row.specialty_name,
    };
  });

  return buildTimeline({
    treatments: treatmentSources,
    lifecycleEvents,
    preparations,
    stockMovements,
    intakeRecords,
  });
}
