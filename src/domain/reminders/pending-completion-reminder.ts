/**
 * Rappel dédié au complément d'une case laissée « en attente de complément »
 * (ticket 30b) : mécanisme séparé du rappel hebdomadaire de préparation
 * (ticket 10) et des rappels quotidiens de prise (ticket 13), ni fondu ni
 * greffé sur leur planification.
 */

/**
 * Délai par défaut lorsque le traitement n'a pas encore de date théorique de
 * renouvellement renseignée (ticket 30) : un choix produit générique de
 * relance, jamais déduit d'une donnée pharmaceutique.
 */
export const DEFAULT_PENDING_COMPLETION_REMINDER_DELAY_DAYS = 7;

/** Heure fixe du rappel, faute de réglage dédié pour ce mécanisme minimal. */
export const PENDING_COMPLETION_REMINDER_HOUR = 9;
export const PENDING_COMPLETION_REMINDER_MINUTE = 0;

/**
 * Date de déclenchement du rappel : la date théorique de renouvellement du
 * traitement si elle est renseignée, sinon `validationDate` + le délai par
 * défaut.
 */
export function pendingCompletionReminderDate(
  theoreticalRenewalDate: string | null,
  validationDate: string,
): string {
  if (theoreticalRenewalDate !== null) return theoreticalRenewalDate;
  return addCivilDays(
    validationDate,
    DEFAULT_PENDING_COMPLETION_REMINDER_DELAY_DAYS,
  );
}

function addCivilDays(value: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Date invalide.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new Error('Date invalide.');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
