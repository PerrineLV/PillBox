import { StyleSheet, Text } from 'react-native';

import {
  forecastAlertBadge,
  forecastAvailabilityLabel,
  forecastCoverageLabel,
} from './forecast-labels';
import type { MedicationForecast } from '@/domain/forecast/stock-forecast';
import { Badge, Card, spacing, typography } from '@/ui';

/**
 * Résumé prédictif d'un médicament, affiché au-dessus de ses lots uniquement
 * lorsqu'il appelle une action. Un stock couvert n'affiche rien.
 */
export function StockForecastCard({
  forecast,
}: {
  forecast: MedicationForecast;
}) {
  const badge = forecastAlertBadge(forecast);
  if (badge === null) return null;
  return (
    <Card tone="muted" style={styles.card}>
      <Badge label={badge.label} tone={badge.tone} />
      <Text style={typography.body}>{forecastAvailabilityLabel(forecast)}</Text>
      <Text style={typography.caption}>
        {forecastCoverageLabel(forecast.coverage)}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, marginTop: spacing.sm },
});
