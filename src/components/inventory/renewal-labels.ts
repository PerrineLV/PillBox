import { formatLongFrenchCivilDate } from '@/components/treatments/civil-date';
import type {
  RenewalItem,
  RenewalUrgency,
} from '@/domain/renewal/renewal-list';
import { formatHalfUnits } from '@/domain/treatments/treatment';

export function renewalUrgencyTone(
  urgency: RenewalUrgency,
): 'danger' | 'warning' | 'neutral' {
  if (urgency === 'INSUFFICIENT_FOR_NEXT_PREPARATION') return 'danger';
  if (urgency === 'RUNS_OUT_SOON') return 'warning';
  return 'neutral';
}

export function renewalAvailabilityLabel(item: RenewalItem): string {
  const available = formatHalfUnits(item.availableHalfUnits);
  if (item.nextPreparationHalfUnits === 0)
    return `${available} disponible(s), aucune prise prévue la semaine prochaine.`;
  return `${available} disponible(s) pour ${formatHalfUnits(item.nextPreparationHalfUnits)} nécessaire(s) la semaine prochaine.`;
}

/** `null` lorsque la prévision n'a pas trouvé de date de rupture exploitable. */
export function renewalRuptureLabel(item: RenewalItem): string | null {
  if (item.ruptureDate === null) return null;
  const date = formatLongFrenchCivilDate(item.ruptureDate);
  return item.ruptureCause === 'EXPIRED'
    ? `Rupture estimée le ${date} : un lot périme avant d’être consommé.`
    : `Rupture estimée le ${date}.`;
}

/**
 * Information complémentaire, purement indicative (ticket 30) : n'influence
 * jamais l'urgence affichée ni l'ordre de la liste. `null` en l'absence de
 * délivrance encadrée activée pour ce médicament.
 */
export function renewalTheoreticalRenewalLabel(
  item: RenewalItem,
): string | null {
  if (item.theoreticalRenewalDate === null) return null;
  return `Renouvellement théorique (délivrance encadrée) : ${formatLongFrenchCivilDate(item.theoreticalRenewalDate)}.`;
}
