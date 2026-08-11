import { formatLongFrenchCivilDate } from '@/components/treatments/civil-date';
import type {
  ForecastCoverage,
  MedicationForecast,
  StockForecast,
} from '@/domain/forecast/stock-forecast';
import { formatHalfUnits } from '@/domain/treatments/treatment';

export type ForecastStatusBadge = Readonly<{
  label: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}>;

/**
 * Formule la couverture du stock. Aucune date n'est produite hors du cas où la
 * simulation en a réellement trouvé une : les autres situations sont énoncées
 * telles quelles plutôt que déguisées en estimation.
 */
export function forecastCoverageLabel(coverage: ForecastCoverage): string {
  if (coverage.status === 'NO_FUTURE_INTAKE')
    return 'Aucune prise prévue : la date de rupture n’est pas calculable.';
  if (coverage.status === 'BEYOND_HORIZON')
    return `Aucune rupture prévue dans les ${coverage.horizonDays} prochains jours.`;

  const date = formatLongFrenchCivilDate(coverage.date);
  const expiration =
    coverage.cause === 'EXPIRED' ? ' Un lot périme avant d’être consommé.' : '';
  if (coverage.coveredDays === 0)
    return `Rupture estimée dès le ${date}.${expiration}`;
  const days = coverage.coveredDays === 1 ? 'jour couvert' : 'jours couverts';
  return `Rupture estimée le ${date}, soit ${coverage.coveredDays} ${days}.${expiration}`;
}

/**
 * Badge d'alerte, ou `null` lorsque la prévision n'appelle aucune action. Un
 * stock couvert et un médicament sans prise prévue ne produisent donc rien à
 * l'écran : c'est ce silence qui rend les deux vraies alertes visibles.
 * La fenêtre ne couvrant que les deux prochains cycles, toute rupture trouvée
 * est proche et n'a pas besoin d'un second seuil.
 */
export function forecastAlertBadge(
  forecast: MedicationForecast,
): ForecastStatusBadge | null {
  if (forecast.insufficientForNextPreparation)
    return {
      label: 'Insuffisant pour la prochaine préparation',
      tone: 'danger',
    };
  if (forecast.coverage.status === 'RUNS_OUT')
    return { label: 'Rupture à prévoir', tone: 'warning' };
  return null;
}

export type ForecastSummary = Readonly<{
  label: string;
  /** Nombre de médicaments portant une carte, qui donne son ton au bandeau. */
  alertCount: number;
}>;

/**
 * Ligne unique en tête d'écran. Elle existe pour que l'absence de carte reste
 * lisible : sans elle, rien ne distinguerait « tout va bien » de « rien n'a été
 * calculé ». Le compte vient de `forecastAlertBadge`, donc le résumé ne peut
 * pas diverger des cartes réellement affichées en dessous.
 */
export function forecastSummary(forecast: StockForecast): ForecastSummary {
  const alertCount = forecast.medications.filter(
    (medication) => forecastAlertBadge(medication) !== null,
  ).length;
  const window = `Prévision à ${forecast.horizonDays} jours`;
  return {
    alertCount,
    label:
      alertCount === 0
        ? `${window} : aucune rupture prévue.`
        : `${window} : ${alertCount} médicament${alertCount > 1 ? 's' : ''} à surveiller.`,
  };
}

export function forecastAvailabilityLabel(
  forecast: MedicationForecast,
): string {
  const available = formatHalfUnits(forecast.availableHalfUnits);
  if (forecast.nextPreparationHalfUnits === 0)
    return `${available} disponible(s), aucune prise prévue la semaine prochaine.`;
  return `${available} disponible(s) pour ${formatHalfUnits(forecast.nextPreparationHalfUnits)} nécessaire(s) la semaine prochaine.`;
}
