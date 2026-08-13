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
  localCivilDate,
  planIntakeReminders,
  startOfLocalDay,
  type IntakeSlotTimes,
  type PlannedIntakeReminder,
} from '@/domain/reminders/intake-reminder';
import type { RenewalItem } from '@/domain/renewal/renewal-list';
import type { IntakeSlot, Treatment } from '@/domain/treatments/treatment';

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
  | AsNeededAttentionItem;

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

export type AttentionItemsInput = Readonly<{
  referenceDate: string;
  now: Date;
  intakeRemindersEnabled: boolean;
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
    buildPreparationItem(input),
    ...input.renewalItems.map((item): StockRenewalAttentionItem => ({
      type: 'STOCK_RENEWAL',
      id: `stock-renewal:${item.specialtyCis}`,
      item,
    })),
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
 * Toujours présente : la préparation du pilulier reste le parcours
 * prioritaire de PillBox (ticket 11f), qu'elle reste à démarrer, à reprendre
 * ou qu'elle soit déjà prête. Une préparation en cours (DRAFT) est par
 * construction la préparation incomplète à reprendre : le modèle métier
 * n'autorise qu'une seule préparation active à la fois, donc ce même item
 * couvre à la fois « prochaine préparation » et « préparation incomplète ».
 */
function buildPreparationItem(
  input: AttentionItemsInput,
): PreparationAttentionItem {
  if (input.draftPreparation) {
    return {
      type: 'PREPARATION',
      id: 'preparation:draft',
      mode: 'RESUME',
      startDate: input.draftPreparation.startDate,
      endDate: input.draftPreparation.endDate,
      completedCount: input.draftPreparation.completedCount,
      totalCount: input.draftPreparation.totalCount,
    };
  }
  const nextWeek = preparationWeeks(input.referenceDate)[0];
  const state = preparationWeekState(
    nextWeek.startDate,
    input.knownPreparationWeeks,
  );
  return {
    type: 'PREPARATION',
    id: 'preparation:next',
    mode: state === 'ALREADY_PREPARED' ? 'READY' : 'START',
    startDate: nextWeek.startDate,
    endDate: nextWeek.endDate,
    completedCount: 0,
    totalCount: 0,
  };
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
