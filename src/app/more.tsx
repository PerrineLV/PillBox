import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { installedAppVersion } from '@/infrastructure/updates/installed-version';
import {
  Screen,
  colors,
  radii,
  shadows,
  sizes,
  spacing,
  typography,
} from '@/ui';

type MenuRoute =
  | '/preparations/history'
  | '/intakes/history'
  | '/settings'
  // TEMPORAIRE (debug) : à retirer avec l'item « Debug mise à jour » ci-dessous.
  | '/developer/update-check-state';
type IconName = 'calendar' | 'check' | 'settings';

const ITEMS: readonly {
  href: MenuRoute;
  icon: IconName;
  title: string;
  detail: string;
}[] = [
  {
    href: '/preparations/history',
    icon: 'calendar',
    title: 'Préparations',
    detail: 'Piluliers terminés et lots utilisés',
  },
  {
    href: '/intakes/history',
    icon: 'check',
    title: 'Prises',
    detail: 'Statuts, reports et corrections',
  },
  {
    href: '/settings',
    icon: 'settings',
    title: 'Réglages',
    detail: 'Rappels, confidentialité et sauvegardes',
  },
  // TEMPORAIRE (debug jetable) : accès à l'écran de diagnostic de la détection
  // de mise à jour. À SUPPRIMER avant la prochaine release réelle, en même
  // temps que src/app/developer/update-check-state.tsx et l'entrée
  // correspondante de MenuRoute. Ne doit pas atteindre `main`.
  {
    href: '/developer/update-check-state',
    icon: 'settings',
    title: 'Debug mise à jour',
    detail: 'Temporaire : file SQLite et cache update_check_settings',
  },
];

export default function MoreScreen() {
  return (
    <Screen
      fixedHeader={
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            Plus
          </Text>
          <Text style={styles.introduction}>Historique, suivi et réglages</Text>
        </View>
      }
      stickyFooter={<PrivacyCard />}
      stickyFooterStyle={styles.privacyFooter}
    >
      <View style={styles.menu}>
        {ITEMS.map((item) => (
          <MenuCard key={item.href} {...item} />
        ))}
      </View>
      <InstalledVersion />
    </Screen>
  );
}

/** Version réellement installée, utile pour vérifier une mise à jour. */
function InstalledVersion() {
  const version = installedAppVersion();
  return (
    <Text style={styles.version}>
      {version === null
        ? 'Version installée indisponible'
        : `PillBox version ${version}`}
    </Text>
  );
}

function PrivacyCard() {
  return (
    <View accessibilityRole="summary" style={styles.privacyCard}>
      <View accessibilityElementsHidden style={styles.privacyIcon}>
        <LineIcon kind="check" />
      </View>
      <Text style={styles.privacyText}>
        Vos données restent enregistrées uniquement sur ce téléphone.
      </Text>
    </View>
  );
}

function MenuCard({
  href,
  icon,
  title,
  detail,
}: {
  href: MenuRoute;
  icon: IconName;
  title: string;
  detail: string;
}) {
  return (
    <Pressable
      accessibilityHint={`Ouvre ${title.toLowerCase()}`}
      accessibilityLabel={`${title}. ${detail}`}
      accessibilityRole="button"
      onPress={() => router.navigate(href)}
      style={({ pressed }) => [styles.menuCard, pressed && styles.pressed]}
    >
      <View accessibilityElementsHidden style={styles.menuIcon}>
        <LineIcon kind={icon} />
      </View>
      <View style={styles.menuText}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuDetail}>{detail}</Text>
      </View>
      <View accessibilityElementsHidden style={styles.chevron} />
    </Pressable>
  );
}

function LineIcon({ kind }: { kind: IconName }) {
  if (kind === 'calendar')
    return (
      <View style={styles.calendarIcon}>
        <View style={styles.calendarTop} />
        <View style={[styles.calendarRing, styles.calendarRingLeft]} />
        <View style={[styles.calendarRing, styles.calendarRingRight]} />
      </View>
    );
  if (kind === 'settings')
    return (
      <View style={styles.settingsIcon}>
        <View style={[styles.settingLine, styles.settingLineTop]}>
          <View style={[styles.settingKnob, styles.settingKnobLeft]} />
        </View>
        <View style={[styles.settingLine, styles.settingLineMiddle]}>
          <View style={[styles.settingKnob, styles.settingKnobRight]} />
        </View>
        <View style={[styles.settingLine, styles.settingLineBottom]}>
          <View style={[styles.settingKnob, styles.settingKnobLeft]} />
        </View>
      </View>
    );
  return (
    <View style={styles.checkIcon}>
      <View style={styles.checkShort} />
      <View style={styles.checkLong} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: 2 },
  title: typography.title,
  introduction: typography.caption,
  menu: { gap: spacing.md },
  menuCard: {
    ...shadows.card,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 88,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  pressed: {
    backgroundColor: colors.brandSoft,
    borderColor: colors.brand,
    elevation: 0,
    opacity: 0.88,
  },
  menuIcon: {
    alignItems: 'center',
    backgroundColor: colors.brandSoft,
    borderRadius: radii.md,
    height: sizes.touch,
    justifyContent: 'center',
    width: sizes.touch,
  },
  menuText: { flex: 1, flexShrink: 1, gap: spacing.xs, minWidth: 0 },
  menuTitle: typography.label,
  menuDetail: typography.caption,
  privacyCard: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.brandSoft,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    maxWidth: sizes.screenMaxWidth,
    padding: spacing.md,
    width: '100%',
  },
  privacyFooter: {
    backgroundColor: colors.background,
    borderTopWidth: 0,
  },
  privacyIcon: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  privacyText: { ...typography.caption, color: colors.text, flex: 1 },
  version: {
    ...typography.caption,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  chevron: {
    borderRightColor: colors.brand,
    borderRightWidth: 2,
    borderTopColor: colors.brand,
    borderTopWidth: 2,
    height: 10,
    marginRight: spacing.xs,
    transform: [{ rotate: '45deg' }],
    width: 10,
  },
  calendarIcon: {
    borderColor: colors.brand,
    borderRadius: 4,
    borderWidth: 2,
    height: 21,
    width: 22,
  },
  calendarTop: {
    backgroundColor: colors.brand,
    height: 2,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 6,
  },
  calendarRing: {
    backgroundColor: colors.brand,
    borderRadius: 1,
    height: 5,
    position: 'absolute',
    top: -4,
    width: 2,
  },
  calendarRingLeft: { left: 5 },
  calendarRingRight: { right: 5 },
  checkIcon: {
    borderColor: colors.brand,
    borderRadius: 12,
    borderWidth: 2,
    height: 23,
    position: 'relative',
    width: 23,
  },
  checkShort: {
    backgroundColor: colors.brand,
    height: 2,
    left: 5,
    position: 'absolute',
    top: 11,
    transform: [{ rotate: '45deg' }],
    width: 6,
  },
  checkLong: {
    backgroundColor: colors.brand,
    height: 2,
    left: 8,
    position: 'absolute',
    top: 9,
    transform: [{ rotate: '-48deg' }],
    width: 10,
  },
  settingsIcon: { height: 22, position: 'relative', width: 24 },
  settingLine: {
    backgroundColor: colors.brand,
    height: 2,
    left: 1,
    position: 'absolute',
    right: 1,
  },
  settingLineTop: { top: 3 },
  settingLineMiddle: { top: 10 },
  settingLineBottom: { top: 17 },
  settingKnob: {
    backgroundColor: colors.brandSoft,
    borderColor: colors.brand,
    borderRadius: 4,
    borderWidth: 2,
    height: 8,
    position: 'absolute',
    top: -3,
    width: 8,
  },
  settingKnobLeft: { left: 3 },
  settingKnobRight: { right: 3 },
});
