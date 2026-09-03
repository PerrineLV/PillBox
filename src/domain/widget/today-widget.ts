import type { IntakeRecord } from '@/domain/intakes/intake-tracking';
import type { PlannedIntakeReminder } from '@/domain/reminders/intake-reminder';
import {
  formatHalfUnits,
  type IntakeSlot,
} from '@/domain/treatments/treatment';

/** Lignes du panneau : trois tiennent dans la hauteur du widget large. */
export const TODAY_WIDGET_MEDICATION_ROWS = 3;

export type TodayWidgetMedication = Readonly<{
  name: string;
  quantity: string;
  /** Renseignée, prise ou ignorée : le widget ne distingue pas les deux. */
  checked: boolean;
}>;

export type TodayWidgetSlot = Readonly<{
  scheduledAt: string;
  medicationCount: number;
  state: 'UPCOMING' | 'DUE' | 'VALIDATED';
  target: string;
  medications: readonly TodayWidgetMedication[];
}>;

/**
 * Ce que le widget affiche, déjà mis en mots. Le code natif ne fait que poser
 * ces chaînes : aucune règle ni aucune formulation ne vit en Kotlin, où elles
 * échapperaient aux tests.
 */
export type TodayWidgetDisplay = Readonly<{
  /** « À prendre », « Prochaine prise », « Aujourd'hui ». */
  eyebrow: string;
  /** « Soir · 19:00 », ou l'action de préparation. */
  title: string;
  /** « 2 sur 3 », « 3 médicaments ». */
  detail: string;
  validated: boolean;
  /** Libellé de l'action, `null` lorsqu'il n'y a rien à valider. */
  actionLabel: string | null;
  medications: readonly TodayWidgetMedication[];
  target: string;
}>;

export type TodayWidgetSnapshot = Readonly<{
  generatedAt: string;
  preparationAction: boolean;
  slots: readonly TodayWidgetSlot[];
  display: TodayWidgetDisplay;
}>;

/** Projection d'affichage : le widget natif ne recalcule jamais de posologie. */
export function buildTodayWidgetSnapshot(
  reminders: readonly PlannedIntakeReminder[],
  records: readonly IntakeRecord[],
  now: Date,
  preparationAction: boolean,
  targetForGroups: (groups: PlannedIntakeReminder['groups']) => string,
  slotLabel: (slot: IntakeSlot) => string,
): TodayWidgetSnapshot {
  const slots = reminders.map((reminder): TodayWidgetSlot => {
    const expected = reminder.treatmentIds.length;
    const groupRecords = records.filter((record) =>
      reminder.groups.some(
        (group) => group.date === record.date && group.slot === record.slot,
      ),
    );
    const validated =
      groupRecords.length === expected &&
      groupRecords.every((record) => record.status !== 'UNSET');
    return {
      scheduledAt: reminder.scheduledAt.toISOString(),
      medicationCount: expected,
      state: validated
        ? 'VALIDATED'
        : reminder.scheduledAt <= now
          ? 'DUE'
          : 'UPCOMING',
      target: targetForGroups(reminder.groups),
      medications: groupRecords.map((record) => ({
        name: record.specialtyName,
        quantity: `${formatHalfUnits(record.quantityHalfUnits)} unité(s)`,
        checked: record.status !== 'UNSET',
      })),
    };
  });
  return {
    generatedAt: now.toISOString(),
    preparationAction,
    slots,
    display: buildDisplay(slots, reminders, preparationAction, slotLabel),
  };
}

/**
 * Un seul créneau est montré : le premier qui attend encore quelque chose,
 * sinon le dernier de la journée, pour que le widget confirme que tout est
 * renseigné plutôt que de rester vide.
 *
 * La préparation du pilulier passe devant : c'est l'action du jour, et elle ne
 * revient qu'une fois par semaine.
 */
function buildDisplay(
  slots: readonly TodayWidgetSlot[],
  reminders: readonly PlannedIntakeReminder[],
  preparationAction: boolean,
  slotLabel: (slot: IntakeSlot) => string,
): TodayWidgetDisplay {
  if (preparationAction) {
    return {
      eyebrow: 'Aujourd’hui',
      title: 'Remplir le pilulier',
      detail: 'Préparation de la semaine',
      validated: false,
      actionLabel: 'Ouvrir',
      medications: [],
      target: 'pillbox://preparations/new',
    };
  }
  const index = pickSlotIndex(slots);
  const slot = index === null ? null : slots[index];
  if (slot === null || index === null) {
    return {
      eyebrow: 'Aujourd’hui',
      title: 'Rien de prévu',
      detail: 'Aucune prise programmée',
      validated: false,
      actionLabel: null,
      medications: [],
      target: 'pillbox://',
    };
  }
  const first = reminders[index].groups[0];
  const remaining = slot.medications.filter(
    (medication) => !medication.checked,
  ).length;
  return {
    eyebrow: eyebrowFor(slot.state),
    title: `${slotLabel(first.slot)} · ${formatLocalTime(slot.scheduledAt)}`,
    detail:
      slot.state === 'VALIDATED'
        ? countLabel(slot)
        : `${remaining} sur ${slot.medicationCount}`,
    validated: slot.state === 'VALIDATED',
    actionLabel: slot.state === 'VALIDATED' ? null : 'Valider',
    medications: slot.medications.slice(0, TODAY_WIDGET_MEDICATION_ROWS),
    target: slot.target,
  };
}

function pickSlotIndex(slots: readonly TodayWidgetSlot[]): number | null {
  if (slots.length === 0) return null;
  const pending = slots.findIndex((slot) => slot.state !== 'VALIDATED');
  return pending === -1 ? slots.length - 1 : pending;
}

/**
 * Pas de compte à rebours : le widget n'est rafraîchi que toutes les trente
 * minutes, un « dans 2 h 40 » y serait faux la plupart du temps. L'heure exacte
 * du créneau, elle, reste juste — elle est dans le titre.
 */
function eyebrowFor(state: TodayWidgetSlot['state']): string {
  if (state === 'VALIDATED') return 'Créneau renseigné';
  return state === 'DUE' ? 'À prendre' : 'Prochaine prise';
}

function countLabel(slot: TodayWidgetSlot): string {
  return `${slot.medicationCount} médicament${slot.medicationCount > 1 ? 's' : ''}`;
}

/** Formaté depuis l'heure locale : identique quel que soit l'environnement. */
function formatLocalTime(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
