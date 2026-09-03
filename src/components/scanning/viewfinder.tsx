import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, onDarkSurfaces, radii } from '@/ui';

/**
 * Viseur de scan commun à l'ajout d'une boîte au stock et à la vérification
 * d'une boîte pendant la préparation : c'est le même geste, il doit avoir la
 * même apparence.
 */
export function Viewfinder({ caption }: Readonly<{ caption: string }>) {
  return (
    <View style={styles.area}>
      <View accessibilityElementsHidden style={styles.frame}>
        <View style={[styles.corner, styles.cornerTopLeft]} />
        <View style={[styles.corner, styles.cornerTopRight]} />
        <View style={[styles.corner, styles.cornerBottomLeft]} />
        <View style={[styles.corner, styles.cornerBottomRight]} />
        <View style={styles.line} />
      </View>
      <Text style={styles.caption}>{caption}</Text>
    </View>
  );
}

/** En-tête sombre d'un écran de scan : retour rond, titre, échappatoire. */
export function ScanHeader({
  title,
  onBack,
  action,
}: Readonly<{
  title: string;
  onBack(): void;
  action?: ReactNode;
}>) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityLabel="Revenir en arrière"
        accessibilityRole="button"
        onPress={onBack}
        style={styles.back}
      >
        <Text style={styles.backChevron}>‹</Text>
      </Pressable>
      <Text style={styles.title}>{title}</Text>
      {action}
    </View>
  );
}

/** Lien d'échappatoire : le scan ne doit jamais être la seule voie. */
export function WithoutScanLink({
  label = 'Sans scan',
  onPress,
  accessibilityLabel,
}: Readonly<{
  label?: string;
  onPress(): void;
  accessibilityLabel: string;
}>) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
    >
      <Text style={styles.withoutScan}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  area: { alignItems: 'center', flex: 1, gap: 22, justifyContent: 'center' },
  frame: { height: 230, width: 230 },
  corner: {
    borderColor: colors.accentOnDark,
    height: 46,
    position: 'absolute',
    width: 46,
  },
  cornerTopLeft: {
    borderLeftWidth: 3,
    borderTopLeftRadius: 14,
    borderTopWidth: 3,
    left: 0,
    top: 0,
  },
  cornerTopRight: {
    borderRightWidth: 3,
    borderTopRightRadius: 14,
    borderTopWidth: 3,
    right: 0,
    top: 0,
  },
  cornerBottomLeft: {
    borderBottomLeftRadius: 14,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    bottom: 0,
    left: 0,
  },
  cornerBottomRight: {
    borderBottomRightRadius: 14,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    bottom: 0,
    right: 0,
  },
  line: {
    backgroundColor: colors.accentOnDark,
    height: 2,
    left: 0,
    opacity: 0.65,
    position: 'absolute',
    right: 0,
    top: '50%',
  },
  caption: {
    color: colors.onDarkMuted,
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 19,
    maxWidth: 280,
    textAlign: 'center',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  back: {
    alignItems: 'center',
    backgroundColor: onDarkSurfaces.control,
    borderRadius: radii.pill,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  backChevron: {
    color: colors.onDark,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 28,
  },
  title: {
    color: colors.onDark,
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 20,
  },
  withoutScan: {
    color: colors.accentOnDark,
    fontSize: 12.5,
    fontWeight: '700',
    lineHeight: 15,
  },
});
