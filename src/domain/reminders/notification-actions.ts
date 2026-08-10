import { GROUP_VALIDATION_MINIMUM_PENDING } from '@/domain/intakes/intake-tracking';

import {
  notificationTarget,
  type IntakeGroupReference,
} from './notification-navigation';

/**
 * Actions rapides portées par les rappels de prise Android.
 *
 * Une notification n’expose qu’un seul bouton, dont le libellé dépend du nombre
 * de médicaments encore en attente au moment où le rappel est programmé. Le
 * comportement, lui, est toujours identique : valider les prises encore en
 * attente du ou des créneaux concernés. Un libellé devenu inexact entre la
 * programmation et le déclenchement n’a donc aucune conséquence métier, puisque
 * l’action ne touche jamais une prise déjà renseignée.
 *
 * La décision est volontairement séparée d’`expo-notifications` : elle doit
 * rester testable sans module natif.
 */

export const VALIDATE_INTAKES_ACTION = 'pillbox-validate-intakes';

export const SINGLE_INTAKE_CATEGORY = 'pillbox-intake-single';
export const GROUP_INTAKE_CATEGORY = 'pillbox-intake-group';

export interface IntakeActionCategory {
  readonly identifier: string;
  /** Texte du bouton. Neutre : il ne nomme jamais un médicament ni une dose. */
  readonly buttonTitle: string;
}

export const INTAKE_ACTION_CATEGORIES: readonly IntakeActionCategory[] = [
  { identifier: SINGLE_INTAKE_CATEGORY, buttonTitle: 'Valider' },
  { identifier: GROUP_INTAKE_CATEGORY, buttonTitle: 'Tout valider' },
];

/**
 * Catégorie à attacher à un rappel selon le nombre de prises en attente.
 * Sans prise en attente, aucun bouton n’est proposé : il n’y aurait rien à
 * valider et l’action donnerait une fausse impression d’effet.
 */
export function intakeActionCategory(pendingCount: number): string | null {
  if (!Number.isSafeInteger(pendingCount) || pendingCount <= 0) return null;
  return pendingCount >= GROUP_VALIDATION_MINIMUM_PENDING
    ? GROUP_INTAKE_CATEGORY
    : SINGLE_INTAKE_CATEGORY;
}

/** Traitement demandé par l’appui sur un bouton d’action de notification. */
export type NotificationCommand = {
  readonly kind: 'validate-intakes';
  readonly groups: readonly IntakeGroupReference[];
};

/**
 * Traduit une réponse de notification en commande à exécuter, ou `null` lorsque
 * la réponse n’est pas l’un de nos boutons d’action : un appui standard ouvre
 * l’application et ne valide jamais quoi que ce soit implicitement.
 */
export function notificationCommand(
  actionIdentifier: string,
  data: unknown,
): NotificationCommand | null {
  if (actionIdentifier !== VALIDATE_INTAKES_ACTION) return null;
  const target = notificationTarget(data);
  if (target === null) return null;
  switch (target.kind) {
    case 'planned-intake':
      return target.groups.length === 0
        ? null
        : { kind: 'validate-intakes', groups: target.groups };
    case 'postponed-intake':
      return {
        kind: 'validate-intakes',
        groups: [{ date: target.date, slot: target.slot }],
      };
    default:
      return null;
  }
}
