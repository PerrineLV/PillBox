import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { UpdateNotice } from '@/domain/updates/update-notice';
import { ArrowIcon, colors, radii, sizes, typography } from '@/ui';

/**
 * Information non bloquante, posée en tête de l'écran Plus : elle ne masque
 * aucun contenu et n'empêche aucune action. Une seule ligne, deux cibles —
 * télécharger, ou écarter jusqu'à la prochaine version.
 *
 * Le détail (APK ou page de release, autorisation Android) n'est plus écrit
 * sous le bouton : il est porté par son indication d'accessibilité, faute de
 * place, et parce qu'il ne se lit utilement qu'au moment d'agir.
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
    <View style={styles.card}>
      <View style={styles.badge}>
        <ArrowIcon
          color={colors.brandPressed}
          direction="down"
          size={14}
          strokeWidth={2.6}
        />
      </View>

      <View style={styles.text}>
        <Text style={styles.title}>Version {notice.version} disponible</Text>
        <Text style={styles.subtitle}>
          Installée : {notice.installedVersion}
        </Text>
      </View>

      <Pressable
        accessibilityHint="Masque cette information jusqu’à la prochaine version"
        accessibilityLabel="Plus tard"
        accessibilityRole="button"
        onPress={onPostpone}
        style={({ pressed }) => [styles.dismiss, pressed && styles.dismissed]}
      >
        <Text accessibilityElementsHidden style={styles.dismissMark}>
          ✕
        </Text>
      </Pressable>

      <Pressable
        accessibilityHint={
          notice.fallbackToReleasePage
            ? 'Ouvre la page de la version sur GitHub. Android demandera d’autoriser l’installation.'
            : 'Ouvre l’APK publié sur GitHub. Android demandera d’autoriser l’installation.'
        }
        accessibilityLabel="Télécharger"
        accessibilityRole="button"
        onPress={onDownload}
        style={({ pressed }) => [
          styles.action,
          pressed && styles.actionPressed,
        ]}
      >
        <Text style={styles.actionLabel}>Télécharger</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.cardBorder,
    borderRadius: radii.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingBottom: 8,
    paddingLeft: 13,
    paddingRight: 8,
    paddingTop: 8,
  },
  badge: {
    alignItems: 'center',
    backgroundColor: colors.brandSoft,
    borderRadius: radii.pill,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  text: { flex: 1, gap: 2, minWidth: 0 },
  title: {
    color: colors.text,
    fontSize: 13.5,
    fontWeight: '700',
    lineHeight: 17,
  },
  subtitle: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  /** Cible tactile pleine, même si la croix n'en occupe que le centre. */
  dismiss: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: sizes.minTouch,
    justifyContent: 'center',
    width: sizes.minTouch,
  },
  dismissed: { backgroundColor: colors.background },
  dismissMark: {
    color: colors.textTertiary,
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 20,
  },
  action: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.pill,
    height: sizes.minTouch,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  actionPressed: { backgroundColor: colors.brandPressed },
  actionLabel: {
    ...typography.buttonLabel,
    color: colors.onDark,
    fontSize: 13,
  },
});
