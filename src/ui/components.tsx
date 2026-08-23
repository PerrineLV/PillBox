import { type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type StyleProp,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { router, usePathname } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radii, shadows, sizes, spacing, typography } from './theme';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'quiet';

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  accessibilityHint,
}: Readonly<{
  label: string;
  onPress(): void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
}>) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        buttonStyles[variant],
        pressed && !inactive && pressedStyles[variant],
        inactive && styles.buttonDisabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={
            variant === 'primary' || variant === 'danger'
              ? colors.surface
              : colors.brand
          }
        />
      ) : null}
      <Text
        style={[
          styles.buttonText,
          buttonTextStyles[variant],
          inactive && styles.buttonTextDisabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function AppField({
  label,
  error,
  help,
  ...props
}: TextInputProps & { label: string; error?: string | null; help?: string }) {
  const described = error ?? help;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={props.accessibilityLabel ?? label}
        accessibilityHint={described}
        placeholderTextColor={colors.textMuted}
        {...props}
        style={[
          styles.input,
          props.multiline && styles.multiline,
          error ? styles.inputError : null,
          props.style,
        ]}
      />
      {described ? (
        <Text
          accessibilityRole={error ? 'alert' : undefined}
          style={error ? styles.fieldError : styles.help}
        >
          {described}
        </Text>
      ) : null}
    </View>
  );
}

export function Card({
  children,
  tone = 'default',
  style,
}: {
  children: ReactNode;
  tone?: 'default' | 'muted';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.card, tone === 'muted' && styles.cardMuted, style]}>
      {children}
    </View>
  );
}

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  return (
    <View style={[styles.badge, badgeStyles[tone]]}>
      <Text style={[styles.badgeText, badgeTextStyles[tone]]}>{label}</Text>
    </View>
  );
}

export function Message({
  title,
  children,
  tone = 'info',
}: {
  title?: string;
  children: ReactNode;
  tone?: 'info' | 'success' | 'warning' | 'error';
}) {
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      style={[styles.message, messageStyles[tone]]}
    >
      <Text style={styles.messageSymbol} accessibilityElementsHidden>
        {tone === 'success'
          ? '✓'
          : tone === 'warning'
            ? '!'
            : tone === 'error'
              ? '×'
              : 'i'}
      </Text>
      <View style={styles.messageContent}>
        {title ? <Text style={styles.messageTitle}>{title}</Text> : null}
        <Text style={styles.messageBody}>{children}</Text>
      </View>
    </View>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {description ? <Text style={styles.help}>{description}</Text> : null}
      {action}
    </View>
  );
}

export function LoadingState({ label = 'Chargement…' }: { label?: string }) {
  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="progressbar"
      style={styles.loading}
    >
      <ActivityIndicator color={colors.brand} />
      <Text style={styles.help}>{label}</Text>
    </View>
  );
}

export function Divider() {
  return <View accessibilityElementsHidden style={styles.divider} />;
}
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.sectionTitle}>
      {children}
    </Text>
  );
}

/**
 * Liste déroulante à choix unique. Centralisée pour que le jour du rappel
 * hebdomadaire et le jour d’une prise hebdomadaire se choisissent de la même
 * manière.
 */
export function SelectField<Value extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choisir',
  accessibilityLabel,
}: {
  label: string;
  value: Value | null;
  options: readonly { value: Value; label: string }[];
  onChange(value: Value): void;
  placeholder?: string;
  accessibilityLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? null;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityLabel={`${accessibilityLabel ?? label}, ${selected?.label ?? placeholder}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={styles.selectButton}
      >
        <Text
          style={[styles.selectText, selected === null && styles.selectMuted]}
        >
          {selected?.label ?? placeholder}
        </Text>
        <Text accessibilityElementsHidden style={styles.selectChevron}>
          {open ? '⌃' : '⌄'}
        </Text>
      </Pressable>
      {open ? (
        <Card style={styles.selectMenu}>
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <Pressable
                accessibilityRole="menuitem"
                accessibilityState={{ selected: isSelected }}
                key={option.value}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={[
                  styles.selectOption,
                  isSelected && styles.selectOptionSelected,
                ]}
              >
                <Text
                  style={[
                    styles.selectOptionText,
                    isSelected && styles.selectOptionTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
                {isSelected ? <Text style={styles.selectCheck}>✓</Text> : null}
              </Pressable>
            );
          })}
        </Card>
      ) : null}
    </View>
  );
}

/** Grille des quatre temps de prise : matin, midi, soir, coucher. */
export function SlotGrid({ children }: { children: ReactNode }) {
  return <View style={styles.slotGrid}>{children}</View>;
}

export function SlotCard({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.slotCard}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

export function Screen({
  children,
  scroll = true,
  fixedHeader,
  stickyFooter,
  stickyFooterStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  fixedHeader?: ReactNode;
  stickyFooter?: ReactNode;
  stickyFooterStyle?: ViewStyle;
}) {
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={styles.screenContent}>{children}</View>
  );
  return (
    <View style={styles.screen}>
      {fixedHeader ? (
        <View style={styles.fixedHeader}>{fixedHeader}</View>
      ) : null}
      {content}
      {stickyFooter ? (
        <View style={[styles.stickyFooter, stickyFooterStyle]}>
          {stickyFooter}
        </View>
      ) : null}
    </View>
  );
}

const NAV_ITEMS = [
  { href: '/' as const, label: 'Accueil' },
  { href: '/treatments' as const, label: 'Traitements' },
  { href: '/inventory' as const, label: 'Stock' },
  { href: '/more' as const, label: 'Plus' },
];

export function BottomNavigation() {
  const pathname = usePathname();
  const visible =
    NAV_ITEMS.some(({ href }) => pathname === href) ||
    pathname === '/preparations/new' ||
    pathname === '/inventory/new';
  if (!visible) return null;
  return (
    <SafeAreaView edges={['bottom']} style={styles.navigationSafeArea}>
      <View accessibilityRole="tablist" style={styles.bottomNavigation}>
        {NAV_ITEMS.map((item) => {
          const selected = pathname === item.href;
          return (
            <Pressable
              key={item.href}
              accessibilityLabel={item.label}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => router.navigate(item.href)}
              style={({ pressed }) => [
                styles.navItem,
                pressed && styles.navItemPressed,
              ]}
            >
              <View accessibilityElementsHidden style={styles.navIconArea}>
                <NavigationIcon
                  kind={item.href}
                  color={selected ? colors.brand : colors.textMuted}
                />
              </View>
              <Text
                adjustsFontSizeToFit
                maxFontSizeMultiplier={1.2}
                minimumFontScale={0.8}
                numberOfLines={1}
                style={[styles.navLabel, selected && styles.navTextSelected]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function NavigationIcon({
  kind,
  color,
}: {
  kind: (typeof NAV_ITEMS)[number]['href'];
  color: string;
}) {
  if (kind === '/') {
    return (
      <View style={styles.homeIcon}>
        <View style={[styles.homeRoof, { borderColor: color }]} />
        <View style={[styles.homeBody, { borderColor: color }]} />
      </View>
    );
  }
  if (kind === '/treatments')
    return (
      <View style={[styles.pillIcon, { borderColor: color }]}>
        <View style={[styles.pillDivider, { backgroundColor: color }]} />
      </View>
    );
  if (kind === '/inventory')
    return (
      <View style={[styles.stockIcon, { borderColor: color }]}>
        <View style={[styles.stockLine, { backgroundColor: color }]} />
      </View>
    );
  return (
    <View style={styles.moreIcon}>
      {[0, 1, 2].map((dot) => (
        <View key={dot} style={[styles.moreDot, { backgroundColor: color }]} />
      ))}
    </View>
  );
}

export function AppModal({
  visible,
  title,
  children,
  primaryLabel,
  onPrimary,
  onCancel,
  destructive = false,
  busy = false,
}: {
  visible: boolean;
  title: string;
  children: ReactNode;
  primaryLabel: string;
  onPrimary(): void;
  onCancel(): void;
  destructive?: boolean;
  busy?: boolean;
}) {
  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={onCancel}
    >
      <View style={styles.modalOverlay}>
        <View accessibilityViewIsModal style={styles.modal}>
          <Text accessibilityRole="header" style={typography.title}>
            {title}
          </Text>
          <View>{children}</View>
          <AppButton
            label={primaryLabel}
            variant={destructive ? 'danger' : 'primary'}
            onPress={onPrimary}
            loading={busy}
          />
          <AppButton
            label="Annuler"
            variant="quiet"
            onPress={onCancel}
            disabled={busy}
          />
        </View>
      </View>
    </Modal>
  );
}

const buttonStyles: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: colors.brand },
  secondary: {
    backgroundColor: colors.surface,
    borderColor: colors.brand,
    borderWidth: 1.5,
  },
  danger: { backgroundColor: colors.danger },
  quiet: { backgroundColor: 'transparent' },
};
const pressedStyles: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: colors.brandPressed },
  secondary: { backgroundColor: colors.brandSoft },
  danger: { backgroundColor: colors.dangerPressed },
  quiet: { backgroundColor: colors.surfaceMuted },
};
const buttonTextStyles: Record<ButtonVariant, TextStyle> = {
  primary: { color: colors.surface },
  secondary: { color: colors.brand },
  danger: { color: colors.surface },
  quiet: { color: colors.brand },
};
const badgeStyles = {
  neutral: { backgroundColor: colors.surfaceMuted },
  success: { backgroundColor: colors.successSoft },
  warning: { backgroundColor: colors.warningSoft },
  danger: { backgroundColor: colors.dangerSoft },
};
const badgeTextStyles = {
  neutral: { color: colors.textMuted },
  success: { color: colors.success },
  warning: { color: colors.warning },
  danger: { color: colors.danger },
};
const messageStyles = {
  info: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  success: { backgroundColor: colors.successSoft, borderColor: colors.success },
  warning: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  error: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
};

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  fixedHeader: {
    alignSelf: 'center',
    backgroundColor: colors.background,
    gap: spacing.lg,
    maxWidth: sizes.screenMaxWidth,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    width: '100%',
  },
  screenContent: {
    alignSelf: 'center',
    flexGrow: 1,
    gap: spacing.lg,
    maxWidth: sizes.screenMaxWidth,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    width: '100%',
  },
  stickyFooter: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    padding: spacing.md,
  },
  button: {
    alignItems: 'center',
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: sizes.touch,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  buttonDisabled: {
    backgroundColor: colors.disabled,
    borderColor: colors.disabled,
  },
  buttonText: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  buttonTextDisabled: { color: colors.disabledText },
  field: { gap: spacing.sm },
  label: typography.label,
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: sizes.touch,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  inputError: { borderColor: colors.danger, borderWidth: 2 },
  fieldError: { ...typography.caption, color: colors.danger },
  help: typography.caption,
  card: {
    ...shadows.card,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  cardMuted: { backgroundColor: colors.surfaceMuted },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  badgeText: { fontSize: 13, fontWeight: '700' },
  message: {
    borderLeftWidth: 4,
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  messageSymbol: { fontSize: 18, fontWeight: '900' },
  messageContent: { flex: 1, gap: spacing.xs },
  messageTitle: typography.label,
  messageBody: typography.body,
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
  },
  emptyTitle: { ...typography.heading, textAlign: 'center' },
  loading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  divider: {
    backgroundColor: colors.border,
    height: 1,
    marginVertical: spacing.sm,
  },
  sectionTitle: typography.heading,
  selectButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: sizes.touch,
    paddingHorizontal: spacing.lg,
  },
  selectText: { ...typography.body, flex: 1, fontWeight: '700' },
  selectMuted: { color: colors.textMuted, fontWeight: '400' },
  selectChevron: { color: colors.brand, fontSize: 22 },
  selectMenu: { gap: 0, padding: spacing.xs },
  selectOption: {
    alignItems: 'center',
    borderRadius: radii.md,
    flexDirection: 'row',
    minHeight: sizes.touch,
    paddingHorizontal: spacing.md,
  },
  selectOptionSelected: { backgroundColor: colors.brandSoft },
  selectOptionText: { ...typography.body, flex: 1 },
  selectOptionTextSelected: { color: colors.brand, fontWeight: '700' },
  selectCheck: { color: colors.success, fontSize: 18, fontWeight: '800' },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  slotCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    minWidth: 140,
    padding: spacing.md,
    width: '48%',
  },
  modalOverlay: {
    backgroundColor: colors.overlay,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modal: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    gap: spacing.lg,
    maxWidth: 520,
    padding: spacing.xl,
    width: '100%',
    alignSelf: 'center',
  },
  navigationSafeArea: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  bottomNavigation: {
    alignSelf: 'center',
    flexDirection: 'row',
    height: 60,
    maxWidth: sizes.screenMaxWidth,
    paddingHorizontal: spacing.sm,
    width: '100%',
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: sizes.touch,
    minWidth: 0,
    overflow: 'hidden',
    paddingHorizontal: spacing.xs,
    width: '25%',
  },
  navItemPressed: { opacity: 0.72 },
  navIconArea: { alignItems: 'center', height: 25, justifyContent: 'center' },
  navLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    maxWidth: '100%',
    textAlign: 'center',
  },
  navTextSelected: { color: colors.brand },
  homeIcon: { height: 20, width: 22 },
  homeRoof: {
    borderLeftWidth: 2,
    borderTopWidth: 2,
    height: 15,
    left: 4,
    position: 'absolute',
    top: 0,
    transform: [{ rotate: '45deg' }],
    width: 15,
  },
  homeBody: {
    borderBottomWidth: 2,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    bottom: 0,
    height: 12,
    left: 3,
    position: 'absolute',
    width: 16,
  },
  pillIcon: {
    borderRadius: 9,
    borderWidth: 2,
    height: 16,
    transform: [{ rotate: '-48deg' }],
    width: 25,
  },
  pillDivider: {
    height: 2,
    left: 10,
    position: 'absolute',
    top: 5,
    transform: [{ rotate: '90deg' }],
    width: 12,
  },
  stockIcon: { borderRadius: 3, borderWidth: 2, height: 20, width: 20 },
  stockLine: {
    height: 2,
    left: 2,
    position: 'absolute',
    top: 7,
    transform: [{ rotate: '28deg' }],
    width: 15,
  },
  moreIcon: { flexDirection: 'row', gap: 4 },
  moreDot: { borderRadius: 3, height: 4, width: 4 },
});
