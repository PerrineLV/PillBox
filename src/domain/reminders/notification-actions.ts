import { GROUP_VALIDATION_MINIMUM_PENDING } from '@/domain/intakes/intake-tracking';

import {
  notificationTarget,
  type IntakeGroupReference,
} from './notification-navigation';

/**
 * Actions rapides portées par les rappels de prise Android.
 *
 * Une notification expose au plus deux boutons : la validation des prises encore
 * en attente, dont le libellé dépend de leur nombre au moment où le rappel est
 * programmé, et l’ouverture de PillBox. Un libellé de validation devenu inexact
 * entre la programmation et le déclenchement n’a aucune conséquence métier,
 * puisque l’action ne touche jamais une prise déjà renseignée.
 *
 * La décision est volontairement séparée d’`expo-notifications` : elle doit
 * rester testable sans module natif.
 */

export const VALIDATE_INTAKES_ACTION = 'pillbox-validate-intakes';
export const OPEN_APP_ACTION = 'pillbox-open-app';

export const OPEN_ONLY_INTAKE_CATEGORY = 'pillbox-intake-open';
export const SINGLE_INTAKE_CATEGORY = 'pillbox-intake-single';
export const GROUP_INTAKE_CATEGORY = 'pillbox-intake-group';

export const OPEN_APP_BUTTON_TITLE = 'Ouvrir PillBox';

/**
 * Android n’affiche que les trois premiers boutons d’une notification. PillBox
 * en déclare deux au maximum : la limite est vérifiée par les tests plutôt que
 * découverte sur l’appareil, où le bouton surnuméraire disparaîtrait en silence.
 */
export const ANDROID_MAXIMUM_NOTIFICATION_ACTIONS = 3;

export interface IntakeActionButton {
  readonly identifier: string;
  /** Texte du bouton. Neutre : il ne nomme jamais un médicament ni une dose. */
  readonly buttonTitle: string;
  /** Vrai lorsque l’appui doit ramener PillBox au premier plan. */
  readonly opensApp: boolean;
}

export interface IntakeActionCategory {
  readonly identifier: string;
  readonly buttons: readonly IntakeActionButton[];
}

const OPEN_APP_BUTTON: IntakeActionButton = {
  identifier: OPEN_APP_ACTION,
  buttonTitle: OPEN_APP_BUTTON_TITLE,
  opensApp: true,
};

function validationButton(buttonTitle: string): IntakeActionButton {
  // La validation n’ouvre jamais l’application : elle doit aboutir depuis le
  // tiroir, sans passer par le verrou local ni afficher la moindre donnée.
  return { identifier: VALIDATE_INTAKES_ACTION, buttonTitle, opensApp: false };
}

export const INTAKE_ACTION_CATEGORIES: readonly IntakeActionCategory[] = [
  { identifier: OPEN_ONLY_INTAKE_CATEGORY, buttons: [OPEN_APP_BUTTON] },
  {
    identifier: SINGLE_INTAKE_CATEGORY,
    buttons: [validationButton('Valider'), OPEN_APP_BUTTON],
  },
  {
    identifier: GROUP_INTAKE_CATEGORY,
    buttons: [validationButton('Tout valider'), OPEN_APP_BUTTON],
  },
];

/**
 * Catégorie à attacher à un rappel selon le nombre de prises en attente.
 *
 * Sans prise en attente — ou avec un compte illisible —, seule l’ouverture de
 * PillBox est proposée : il n’y aurait rien à valider et le bouton donnerait une
 * fausse impression d’effet. Toute notification de prise garde donc au moins le
 * bouton d’ouverture.
 */
export function intakeActionCategory(pendingCount: number): string {
  if (!Number.isSafeInteger(pendingCount) || pendingCount <= 0)
    return OPEN_ONLY_INTAKE_CATEGORY;
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

/** Effets à produire pour honorer une commande venue d’une notification. */
export interface NotificationCommandEffects {
  /** Écrit la confirmation en base. Rejette lorsque l’écriture a échoué. */
  validate: (groups: readonly IntakeGroupReference[]) => Promise<unknown>;
  /** Retire du tiroir Android la notification qui a produit la réponse. */
  dismiss: () => Promise<unknown>;
  /** Marque la réponse comme traitée pour ne pas la rejouer au démarrage suivant. */
  acknowledge: () => void;
}

/**
 * Exécute une commande d’action rapide dans l’ordre imposé par le produit.
 *
 * La notification ne disparaît qu’après confirmation de l’écriture SQLite :
 * si celle-ci échoue, elle reste affichée et l’action pourra être rejouée sans
 * perte. Une disparition impossible — notification déjà retirée, réponse rejouée
 * au démarrage suivant — n’annule pas une écriture réussie : l’action reste
 * marquée comme traitée, sinon elle serait rejouée indéfiniment.
 *
 * La fonction ne rejette jamais : elle est appelée depuis un écouteur de
 * notification, sans personne pour recueillir l’erreur. Aucune donnée n’est
 * journalisée.
 */
export async function runNotificationCommand(
  command: NotificationCommand,
  effects: NotificationCommandEffects,
): Promise<void> {
  try {
    await effects.validate(command.groups);
  } catch {
    return;
  }
  try {
    await effects.dismiss();
  } catch {
    /* La prise est enregistrée ; l’affichage résiduel n’a pas d’effet métier. */
  }
  effects.acknowledge();
}
