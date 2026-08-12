import { normalizeMedicationSearch } from './normalize-medication-search';

/**
 * Mentions connues d'une délivrance encadrée par la réglementation, telles
 * qu'observées dans les conditions de prescription/délivrance de la BDPM
 * (`CIS_CPD_bdpm`, ex. "stupéfiants", "délivrance fractionnée de 7 jours").
 * Liste non exhaustive et volontairement faillible : un rapprochement
 * textuel ne prouve rien, il ne fait que proposer une case à cocher que
 * l'utilisatrice confirme ou écarte elle-même (ticket 30).
 */
const CONTROLLED_DISPENSING_MENTION_PATTERNS = [
  'stupefiant',
  'delivrance fractionnee',
] as const;

export function mentionsControlledDispensing(conditionText: string): boolean {
  const normalized = normalizeMedicationSearch(conditionText);
  return CONTROLLED_DISPENSING_MENTION_PATTERNS.some((pattern) =>
    normalized.includes(pattern),
  );
}
