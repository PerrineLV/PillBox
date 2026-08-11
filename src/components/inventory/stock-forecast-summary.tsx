import { StyleSheet, Text, View } from 'react-native';

import { forecastSummary } from './forecast-labels';
import type { StockForecast } from '@/domain/forecast/stock-forecast';
import { colors, radii, spacing, typography } from '@/ui';

/**
 * Bandeau annonçant la fenêtre couverte par la prévision. Il reste discret
 * quand rien n'est à surveiller et se colore dès qu'une carte apparaît plus
 * bas : le ton suit le contenu plutôt que d'alerter en permanence.
 */
export function StockForecastSummary({
  forecast,
}: {
  forecast: StockForecast;
}) {
  const summary = forecastSummary(forecast);
  const alerting = summary.alertCount > 0;
  return (
    <View style={[styles.banner, alerting && styles.bannerAlerting]}>
      <Text style={[styles.label, alerting && styles.labelAlerting]}>
        {summary.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.brandSoft,
    borderRadius: radii.md,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bannerAlerting: { backgroundColor: colors.warningSoft },
  label: { ...typography.label, color: colors.brand, fontSize: 15 },
  labelAlerting: { color: colors.warning },
});
