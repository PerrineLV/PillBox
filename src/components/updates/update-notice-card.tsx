import { StyleSheet, Text } from 'react-native';

import type { UpdateNotice } from '@/domain/updates/update-notice';
import { AppButton, Badge, Card, colors, spacing, typography } from '@/ui';

/**
 * Carte d'information non bloquante, au langage visuel du design system 11f.
 * Elle ne masque aucun contenu et n'empêche aucune action de l'application.
 */
export function UpdateNoticeCard({
  notice,
  onDownload,
  onPostpone,
}: Readonly<{
  notice: UpdateNotice;
  onDownload(): void;
  onPostpone(): void;
}>) {
  return (
    <Card style={styles.card}>
      <Badge label="Mise à jour" tone="neutral" />
      <Text accessibilityRole="header" style={styles.title}>
        {`PillBox ${notice.version} est disponible`}
      </Text>
      <Text style={styles.body}>
        {`Vous utilisez la version ${notice.installedVersion}. ` +
          (notice.fallbackToReleasePage
            ? 'Le téléchargement ouvre la page de la version sur GitHub. '
            : 'Le téléchargement ouvre l’APK publié sur GitHub. ') +
          'Android vous demandera d’autoriser l’installation.'}
      </Text>
      <AppButton
        label="Télécharger"
        variant="secondary"
        onPress={onDownload}
        accessibilityHint="Ouvre la nouvelle version de PillBox sur GitHub dans le navigateur"
      />
      <AppButton
        label="Plus tard"
        variant="quiet"
        onPress={onPostpone}
        accessibilityHint="Masque cette information jusqu’à la prochaine version"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  body: typography.body,
  card: {
    borderColor: colors.brand,
    gap: spacing.md,
  },
  title: typography.heading,
});
