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
  if (item.usableBoxCount !== null) {
    return item.usableBoxCount === 0
      ? 'Plus aucune boîte utilisable en stock.'
      : `${item.usableBoxCount} boîte${item.usableBoxCount > 1 ? 's' : ''} utilisable(s) en stock.`;
  }
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
 * Information complémentaire, purement indicative (tickets 30 puis 47) :
 * n'influence jamais l'urgence affichée ni l'ordre de la liste. `null` en
 * l'absence de ligne d'ordonnance FRACTIONAL pour ce médicament. Sans
 * tolérance (`start === end`, ex. stupéfiants), la date exacte reste
 * affichée comme avant le ticket 47 ; avec tolérance, la fenêtre complète est
 * montrée pour ne jamais suggérer qu'un renouvellement est possible avant son
 * début.
 */
export function renewalTheoreticalRenewalLabel(
  item: RenewalItem,
): string | null {
  if (item.theoreticalRenewalWindow === null) return null;
  const { start, end } = item.theoreticalRenewalWindow;
  if (start === end)
    return `Renouvellement théorique (délivrance encadrée) : ${formatLongFrenchCivilDate(start)}.`;
  return `Renouvellement possible entre le ${formatLongFrenchCivilDate(start)} et le ${formatLongFrenchCivilDate(end)} (délivrance fractionnée).`;
}

/**
 * Alerte dédiée (ticket 47) : la rupture de stock prévue tombe avant le
 * début de la fenêtre de renouvellement, donc avant qu'une nouvelle
 * délivrance ne soit possible. `null` sinon.
 */
export function renewalRunsOutBeforeWindowLabel(
  item: RenewalItem,
): string | null {
  if (
    !item.runsOutBeforeRenewalWindow ||
    item.theoreticalRenewalWindow === null
  )
    return null;
  return `Le stock s’épuise avant de pouvoir renouveler : rupture estimée avant le ${formatLongFrenchCivilDate(item.theoreticalRenewalWindow.start)}.`;
}
