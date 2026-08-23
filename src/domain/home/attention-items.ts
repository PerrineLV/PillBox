import type { AsNeededIntakeRecord } from '@/domain/intakes/as-needed-intake';
import {
  pendingIntakeCountForGroups,
  type PendingIntakeCount,
} from '@/domain/intakes/intake-tracking';
import {
  preparationWeekState,
  preparationWeeks,
  type KnownPreparation,
} from '@/domain/preparations/preparation';
import {
  isPrescriptionValidityApproaching,
  type PrescriptionStatus,
} from '@/domain/prescriptions/prescription';
import {
  localCivilDate,
  planIntakeReminders,
  startOfLocalDay,
  type IntakeSlotTimes,
  type PlannedIntakeReminder,
} from '@/domain/reminders/intake-reminder';
import type { RenewalItem } from '@/domain/renewal/renewal-list';
import type {
  IntakeSlot,
  Treatment,
  Weekday,
} from '@/domain/treatments/treatment';

/**
 * Au-delà d'une semaine, « la prochaine prise » n'aiderait plus à répondre à
 * la question « qu'est-ce que j'ai à faire maintenant ? » : elle serait trop
 * lointaine pour être utile à l'accueil.
 */
export const NEXT_INTAKE_LOOKAHEAD_DAYS = 7;

export type NextIntakeGroupAttentionItem = Readonly<{
  type: 'NEXT_INTAKE_GROUP';
  id: string;
  scheduledAt: string;
  groups: readonly Readonly<{ date: string; slot: IntakeSlot }>[];
  /** Médicaments encore en attente pour ce créneau, pas le total planifié. */
  medicationCount: number;
}>;

export type PreparationAttentionMode = 'START' | 'RESUME' | 'READY';

export type PreparationAttentionItem = Readonly<{
  type: 'PREPARATION';
  id: string;
  mode: PreparationAttentionMode;
  startDate: string;
  endDate: string;
  completedCount: number;
  totalCount: number;
}>;

export type StockRenewalAttentionItem = Readonly<{
  type: 'STOCK_RENEWAL';
  id: string;
  item: RenewalItem;
}>;

export type ExpirationAttentionItem = Readonly<{
  type: 'EXPIRATION';
  id: string;
  boxId: number;
  specialtyName: string;
  lot: string | null;
  expirationDate: string;
  remainingQuantity: number;
}>;

export type AsNeededAttentionItem = Readonly<{
  type: 'AS_NEEDED_INFO';
  id: string;
  treatmentId: number;
  specialtyName: string;
  lastIntake: AsNeededIntakeRecord | null;
}>;

/**
 * Distincte de `StockRenewalAttentionItem` (ticket 47, délivrance en
 * pharmacie) : celle-ci anticipe la fin de validité de l'ordonnance
 * elle-même, pour prendre rendez-vous avec le médecin (ticket 48).
 */
export type PrescriptionExpiryAttentionItem = Readonly<{
  type: 'PRESCRIPTION_EXPIRY';
  id: string;
  prescriptionId: number;
  label: string;
  validUntil: string;
}>;

/**
 * Collection extensible : chaque type d'item porte ses propres données. Un
 * nouveau type d'alerte (par exemple une boîte de stock sans traitement
 * associé) s'ajoute en étendant cette union et en poussant ses entrées dans
 * `buildAttentionItems`, sans toucher aux autres catégories ni à l'écran.
 */
export type AttentionItem =
  | NextIntakeGroupAttentionItem
  | PreparationAttentionItem
  | StockRenewalAttentionItem
  | ExpirationAttentionItem
  | AsNeededAttentionItem
  | PrescriptionExpiryAttentionItem;

export type DraftPreparationSummary = Readonly<{
  startDate: string;
  endDate: string;
  completedCount: number;
  totalCount: number;
}>;

export type ExpirationAlertInput = Readonly<{
  boxId: number;
  specialtyName: string;
  lot: string | null;
  expirationDate: string;
  remainingQuantity: number;
}>;

export type AsNeededTreatmentInput = Readonly<{
  treatmentId: number;
  specialtyName: string;
  maxQuantityPerDayHalfUnits: number | null;
  minIntervalHours: number | null;
  lastIntake: AsNeededIntakeRecord | null;
}>;

export type PrescriptionAttentionInput = Readonly<{
  id: number;
  label: string;
  status: PrescriptionStatus;
  validUntil: string | null;
}>;

export type AttentionItemsInput = Readonly<{
  referenceDate: string;
  now: Date;
  intakeRemindersEnabled: boolean;
  /**
   * Le rappel de préparation pilote uniquement la proposition de démarrer une
   * nouvelle préparation depuis l'accueil. Une préparation déjà entamée reste
   * toujours accessible, quel que soit ce réglage.
   */
  preparationReminder: Readonly<{ enabled: boolean; weekday: Weekday }>;
  treatments: readonly Treatment[];
  intakeSlotTimes: IntakeSlotTimes;
  /** Prises encore en attente sur l'horizon de recherche (ticket 13b). */
  pendingIntakeCounts: readonly PendingIntakeCount[];
  draftPreparation: DraftPreparationSummary | null;
  knownPreparationWeeks: readonly KnownPreparation[];
  /** Déjà classée par urgence par `buildRenewalList` (tickets 14 et 15). */
  renewalItems: readonly RenewalItem[];
  /** Déjà filtrée aux péremptions nécessitant une action et triée par date. */
  expirations: readonly ExpirationAlertInput[];
  asNeededTreatments: readonly AsNeededTreatmentInput[];
  /** Toutes les ordonnances connues, quel que soit leur statut (ticket 48) : filtrées ici même. */
  prescriptions: readonly PrescriptionAttentionInput[];
}>;

/**
 * Construit, par ordre de priorité décroissante, ce qui demande l'attention
 * de l'utilisatrice sur l'accueil. Aucune règle métier n'est recalculée ici :
 * chaque catégorie consomme le résultat d'un service métier déjà validé
 * (rappels de prise, préparation, prévision de stock et renouvellement,
 * traitements si besoin).
 */
export function buildAttentionItems(
  input: AttentionItemsInput,
): AttentionItem[] {
  return [
    ...buildNextIntakeGroupItems(input),
    ...buildPreparationItems(input),
    ...input.renewalItems.map((item): StockRenewalAttentionItem => ({
      type: 'STOCK_RENEWAL',
      id: `stock-renewal:${item.specialtyCis}`,
      item,
    })),
    ...buildPrescriptionExpiryItems(input.prescriptions, input.referenceDate),
    ...input.expirations.map((expiration): ExpirationAttentionItem => ({
      type: 'EXPIRATION',
      id: `expiration:${expiration.boxId}`,
      ...expiration,
    })),
    ...buildAsNeededItems(input.asNeededTreatments),
  ];
}

/**
 * Un item « requiert une action » lorsqu'il justifie de rompre l'état calme
 * de l'accueil. Les items purement informatifs (prochaine prise à venir,
 * information « si besoin ») ne le déclenchent jamais.
 */
export function isAttentionItemActionRequired(item: AttentionItem): boolean {
  switch (item.type) {
    case 'PREPARATION':
      return item.mode !== 'READY';
    case 'STOCK_RENEWAL':
    case 'EXPIRATION':
    case 'PRESCRIPTION_EXPIRY':
      return true;
    case 'NEXT_INTAKE_GROUP':
    case 'AS_NEEDED_INFO':
      return false;
  }
}

/**
 * Un rappel déjà entièrement confirmé (tout pris ou ignoré) n'a plus rien à
 * demander à l'utilisatrice : la carte passe alors au prochain rappel qui
 * compte encore au moins une prise en attente, plutôt que de rester figée sur
 * un créneau déjà traité.
 */
function buildNextIntakeGroupItems(
  input: AttentionItemsInput,
): readonly NextIntakeGroupAttentionItem[] {
  if (!input.intakeRemindersEnabled) return [];
  const until = new Date(input.now);
  until.setDate(until.getDate() + NEXT_INTAKE_LOOKAHEAD_DAYS);
  const from = startOfLocalDay(localCivilDate(input.now));
  const planned = planIntakeReminders(
    input.treatments,
    input.intakeSlotTimes,
    from,
    until,
  );
  for (const reminder of planned) {
    const pending = pendingIntakeCountForGroups(
      input.pendingIntakeCounts,
      reminder.groups,
    );
    if (pending > 0) return [toNextIntakeGroupItem(reminder, pending)];
  }
  return [];
}

function toNextIntakeGroupItem(
  reminder: PlannedIntakeReminder,
  pendingCount: number,
): NextIntakeGroupAttentionItem {
  return {
    type: 'NEXT_INTAKE_GROUP',
    id: `next-intake:${reminder.scheduledAt.toISOString()}`,
    scheduledAt: reminder.scheduledAt.toISOString(),
    groups: reminder.groups,
    medicationCount: pendingCount,
  };
}

/**
 * Une préparation en cours est toujours visible, car elle demande une reprise
 * explicite. En revanche, la proposition de démarrer la suivante appartient
 * exclusivement au jour du rappel hebdomadaire configuré : l'accueil ne doit
 * pas annoncer la prochaine préparation la veille ou les jours suivants.
 */
function buildPreparationItems(
  input: AttentionItemsInput,
): readonly PreparationAttentionItem[] {
  if (input.draftPreparation) {
    return [
      {
        type: 'PREPARATION',
        id: 'preparation:draft',
        mode: 'RESUME',
        startDate: input.draftPreparation.startDate,
        endDate: input.draftPreparation.endDate,
        completedCount: input.draftPreparation.completedCount,
        totalCount: input.draftPreparation.totalCount,
      },
    ];
  }
  if (
    !input.preparationReminder.enabled ||
    weekdayForDate(input.referenceDate) !== input.preparationReminder.weekday
  )
    return [];
  const nextWeek = preparationWeeks(input.referenceDate)[0];
  const state = preparationWeekState(
    nextWeek.startDate,
    input.knownPreparationWeeks,
  );
  if (state === 'ALREADY_PREPARED') return [];
  return [
    {
      type: 'PREPARATION',
      id: 'preparation:next',
      mode: 'START',
      startDate: nextWeek.startDate,
      endDate: nextWeek.endDate,
      completedCount: 0,
      totalCount: 0,
    },
  ];
}

function weekdayForDate(isoDate: string): Weekday {
  const weekdayByNumber: readonly Weekday[] = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];
  return weekdayByNumber[new Date(`${isoDate}T12:00:00`).getDay()];
}

/**
 * Ordonnances actives dont la fin de validité approche (ticket 48), pour
 * anticiper la prise de rendez-vous médical — distinct de l'alerte de
 * renouvellement en pharmacie (`STOCK_RENEWAL`, ticket 47).
 */
function buildPrescriptionExpiryItems(
  prescriptions: readonly PrescriptionAttentionInput[],
  today: string,
): readonly PrescriptionExpiryAttentionItem[] {
  return prescriptions
    .flatMap((prescription): PrescriptionExpiryAttentionItem[] => {
      if (
        prescription.validUntil === null ||
        !isPrescriptionValidityApproaching(prescription, today)
      )
        return [];
      return [
        {
          type: 'PRESCRIPTION_EXPIRY',
          id: `prescription-expiry:${prescription.id}`,
          prescriptionId: prescription.id,
          label: prescription.label,
          validUntil: prescription.validUntil,
        },
      ];
    })
    .sort((left, right) => left.validUntil.localeCompare(right.validUntil));
}

function buildAsNeededItems(
  treatments: readonly AsNeededTreatmentInput[],
): readonly AsNeededAttentionItem[] {
  return treatments
    .filter(
      (treatment) =>
        treatment.maxQuantityPerDayHalfUnits !== null ||
        treatment.minIntervalHours !== null,
    )
    .map((treatment): AsNeededAttentionItem => ({
      type: 'AS_NEEDED_INFO',
      id: `as-needed:${treatment.treatmentId}`,
      treatmentId: treatment.treatmentId,
      specialtyName: treatment.specialtyName,
      lastIntake: treatment.lastIntake,
    }))
    .sort((left, right) =>
      left.specialtyName.localeCompare(right.specialtyName),
    );
}
