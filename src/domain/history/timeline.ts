import {
  isLegacyTreatmentPhase,
  type IntakeSlot,
  type PhaseFrequency,
  type ScheduledTreatmentPhase,
  type TreatmentPhase,
} from '@/domain/treatments/treatment';

type TimelineEventBase = Readonly<{
  /** Clé stable et déterministe, utilisée pour le tri et le dédoublonnage. */
  id: string;
  occurredAt: string;
  treatmentId: number;
  specialtyName: string;
}>;

export type TimelineEvent =
  | (TimelineEventBase & { type: 'TREATMENT_CREATED' })
  | (TimelineEventBase & { type: 'DOSAGE_MODIFIED' })
  | (TimelineEventBase & { type: 'PHASE_STARTED'; frequency: PhaseFrequency })
  | (TimelineEventBase & { type: 'DOSAGE_INTERRUPTED' })
  | (TimelineEventBase & { type: 'TREATMENT_ARCHIVED' })
  | (TimelineEventBase & { type: 'TREATMENT_REACTIVATED' })
  | (TimelineEventBase & {
      type: 'PREPARATION_COMPLETED';
      preparationId: number;
      startDate: string;
      endDate: string;
    })
  | (TimelineEventBase & {
      type: 'BOX_USED';
      preparationId: number;
      boxId: number;
      lot: string | null;
      expirationDate: string;
      presentationLabel: string;
      quantityHalfUnits: number;
      /**
       * Non nul lorsque la boîte utilisée est un autre membre du même groupe
       * générique officiel (BDPM), confirmé explicitement, plutôt que le CIS
       * strictement attendu.
       */
      matchedCis: string | null;
      matchedSpecialtyName: string | null;
    })
  | (TimelineEventBase & {
      type: 'STOCK_MOVEMENT';
      movementType: 'BOX_ADDED' | 'MANUAL_ADJUSTMENT' | 'CORRECTION';
      quantityDelta: number;
      explanation: string;
      /**
       * Lot et péremption de la boîte concernée (ticket 49) : purement
       * informatif, sans lien cliquable, pour retrouver une boîte y compris
       * épuisée et donc masquée de l'écran Stock.
       */
      lot: string | null;
      expirationDate: string;
    })
  | (TimelineEventBase & {
      type: 'INTAKE_RECORDED';
      date: string;
      slot: IntakeSlot;
      status: 'TAKEN' | 'SKIPPED';
      quantityHalfUnits: number;
    });

export const TIMELINE_EVENT_TYPES = [
  'TREATMENT_CREATED',
  'DOSAGE_MODIFIED',
  'PHASE_STARTED',
  'DOSAGE_INTERRUPTED',
  'TREATMENT_ARCHIVED',
  'TREATMENT_REACTIVATED',
  'PREPARATION_COMPLETED',
  'BOX_USED',
  'STOCK_MOVEMENT',
  'INTAKE_RECORDED',
] as const satisfies readonly TimelineEvent['type'][];

export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

export function isTimelineEventType(value: string): value is TimelineEventType {
  return TIMELINE_EVENT_TYPES.some((type) => type === value);
}

/** Un traitement archivé ou réactivé sans date connue pour les cycles passés à l'introduction de la timeline. */
export type TimelineLifecycleEventSource = Readonly<{
  treatmentId: number;
  type: 'ARCHIVED' | 'REACTIVATED' | 'DOSAGE_MODIFIED';
  occurredAt: string;
}>;

export type TimelineTreatmentSource = Readonly<{
  id: number;
  specialtyName: string;
  createdAt: string;
  /** Phases actuellement enregistrées ; une phase remplacée par une modification ne laisse plus de trace ici. */
  phases: readonly TreatmentPhase[];
}>;

/**
 * Une ligne par boîte utilisée pour couvrir ce médicament dans cette
 * préparation ; `boxId` vaut `null` seulement si une préparation validée n'a
 * laissé aucune trace de lot, ce qui ne devrait jamais arriver.
 */
export type TimelinePreparationSource = Readonly<{
  treatmentId: number;
  preparationId: number;
  startDate: string;
  endDate: string;
  completedAt: string;
  boxId: number | null;
  lot: string | null;
  expirationDate: string | null;
  presentationLabel: string | null;
  quantityHalfUnits: number | null;
  matchedCis: string | null;
  matchedSpecialtyName: string | null;
}>;

export type TimelineStockMovementSource = Readonly<{
  treatmentId: number;
  id: number;
  type: 'BOX_ADDED' | 'MANUAL_ADJUSTMENT' | 'CORRECTION';
  quantityDelta: number;
  explanation: string;
  createdAt: string;
  specialtyName: string;
  lot: string | null;
  expirationDate: string;
}>;

export type TimelineIntakeSource = Readonly<{
  treatmentId: number;
  key: string;
  date: string;
  slot: IntakeSlot;
  status: 'TAKEN' | 'SKIPPED';
  quantityHalfUnits: number;
  updatedAt: string;
  specialtyName: string;
}>;

export type TimelineSource = Readonly<{
  treatments: readonly TimelineTreatmentSource[];
  lifecycleEvents: readonly TimelineLifecycleEventSource[];
  preparations: readonly TimelinePreparationSource[];
  stockMovements: readonly TimelineStockMovementSource[];
  intakeRecords: readonly TimelineIntakeSource[];
}>;

/**
 * Assemble la timeline de consultation à partir des données déjà persistées :
 * aucune date ni posologie n'est recalculée depuis l'état courant d'un
 * traitement. Les préparations et lots proviennent de leurs snapshots
 * historiques, jamais de la posologie actuelle.
 */
export function buildTimeline(source: TimelineSource): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const specialtyNameByTreatment = new Map(
    source.treatments.map((treatment) => [
      treatment.id,
      treatment.specialtyName,
    ]),
  );

  for (const treatment of source.treatments) {
    events.push({
      id: `treatment:${treatment.id}:created`,
      type: 'TREATMENT_CREATED',
      occurredAt: treatment.createdAt,
      treatmentId: treatment.id,
      specialtyName: treatment.specialtyName,
    });

    const scheduled = treatment.phases.filter(
      (phase): phase is ScheduledTreatmentPhase =>
        !isLegacyTreatmentPhase(phase),
    );
    const ordered = [...scheduled].sort((a, b) =>
      a.startDate.localeCompare(b.startDate),
    );
    ordered.forEach((phase, index) => {
      events.push({
        id: `phase:${phase.id ?? `${treatment.id}-${index}`}:started`,
        type: 'PHASE_STARTED',
        occurredAt: phase.startDate,
        treatmentId: treatment.id,
        specialtyName: treatment.specialtyName,
        frequency: phase.frequency,
      });
    });
    const last = ordered.at(-1);
    if (last && last.endDate !== null) {
      events.push({
        id: `phase:${last.id ?? `${treatment.id}-last`}:interrupted`,
        type: 'DOSAGE_INTERRUPTED',
        occurredAt: last.endDate,
        treatmentId: treatment.id,
        specialtyName: treatment.specialtyName,
      });
    }
  }

  for (const lifecycle of source.lifecycleEvents) {
    const specialtyName =
      specialtyNameByTreatment.get(lifecycle.treatmentId) ?? '';
    const base = {
      id: `lifecycle:${lifecycle.treatmentId}:${lifecycle.type}:${lifecycle.occurredAt}`,
      occurredAt: lifecycle.occurredAt,
      treatmentId: lifecycle.treatmentId,
      specialtyName,
    };
    if (lifecycle.type === 'ARCHIVED')
      events.push({ ...base, type: 'TREATMENT_ARCHIVED' });
    else if (lifecycle.type === 'REACTIVATED')
      events.push({ ...base, type: 'TREATMENT_REACTIVATED' });
    else events.push({ ...base, type: 'DOSAGE_MODIFIED' });
  }

  const seenPreparations = new Set<string>();
  for (const row of source.preparations) {
    const preparationKey = `${row.treatmentId}:${row.preparationId}`;
    if (!seenPreparations.has(preparationKey)) {
      seenPreparations.add(preparationKey);
      events.push({
        id: `preparation:${preparationKey}`,
        type: 'PREPARATION_COMPLETED',
        occurredAt: row.completedAt,
        treatmentId: row.treatmentId,
        specialtyName: specialtyNameByTreatment.get(row.treatmentId) ?? '',
        preparationId: row.preparationId,
        startDate: row.startDate,
        endDate: row.endDate,
      });
    }
    if (
      row.boxId !== null &&
      row.expirationDate !== null &&
      row.presentationLabel !== null &&
      row.quantityHalfUnits !== null
    ) {
      events.push({
        id: `box-usage:${preparationKey}:${row.boxId}`,
        type: 'BOX_USED',
        occurredAt: row.completedAt,
        treatmentId: row.treatmentId,
        specialtyName: specialtyNameByTreatment.get(row.treatmentId) ?? '',
        preparationId: row.preparationId,
        boxId: row.boxId,
        lot: row.lot,
        expirationDate: row.expirationDate,
        presentationLabel: row.presentationLabel,
        quantityHalfUnits: row.quantityHalfUnits,
        matchedCis: row.matchedCis,
        matchedSpecialtyName: row.matchedSpecialtyName,
      });
    }
  }

  for (const movement of source.stockMovements) {
    events.push({
      id: `stock:${movement.treatmentId}:${movement.id}`,
      type: 'STOCK_MOVEMENT',
      occurredAt: movement.createdAt,
      treatmentId: movement.treatmentId,
      specialtyName: movement.specialtyName,
      movementType: movement.type,
      quantityDelta: movement.quantityDelta,
      explanation: movement.explanation,
      lot: movement.lot,
      expirationDate: movement.expirationDate,
    });
  }

  for (const intake of source.intakeRecords) {
    events.push({
      id: `intake:${intake.treatmentId}:${intake.key}`,
      type: 'INTAKE_RECORDED',
      occurredAt: intake.updatedAt,
      treatmentId: intake.treatmentId,
      specialtyName: intake.specialtyName,
      date: intake.date,
      slot: intake.slot,
      status: intake.status,
      quantityHalfUnits: intake.quantityHalfUnits,
    });
  }

  return events.sort((a, b) => {
    if (a.occurredAt !== b.occurredAt)
      return a.occurredAt.localeCompare(b.occurredAt);
    return a.id.localeCompare(b.id);
  });
}

export type TimelineFilters = Readonly<{
  /** `null` signifie « tous les types ». */
  types: readonly TimelineEventType[] | null;
  startDate: string | null;
  endDate: string | null;
}>;

/**
 * Filtre une timeline déjà construite. La comparaison de période se fait sur
 * les dix premiers caractères de `occurredAt`, qu'il s'agisse d'une date
 * civile (`AAAA-MM-JJ`) ou d'un horodatage complet, pour rester cohérente sur
 * tous les types d'événements.
 */
export function filterTimelineEvents(
  events: readonly TimelineEvent[],
  filters: TimelineFilters,
): TimelineEvent[] {
  return events.filter((event) => {
    if (filters.types !== null && !filters.types.includes(event.type))
      return false;
    const day = event.occurredAt.slice(0, 10);
    if (filters.startDate !== null && day < filters.startDate) return false;
    if (filters.endDate !== null && day > filters.endDate) return false;
    return true;
  });
}
