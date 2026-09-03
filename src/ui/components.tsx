import { type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { router, usePathname } from 'expo-router';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { colors, layout, radii, sizes, typography } from './theme';

type ButtonVariant = 'primary' | 'danger' | 'quiet';

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
      <View style={styles.messageContent}>
        {title ? (
          <Text style={[styles.messageTitle, messageTextStyles[tone]]}>
            {title}
          </Text>
        ) : null}
        <Text style={[styles.messageBody, messageTextStyles[tone]]}>
          {children}
        </Text>
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
        <View style={styles.selectMenu}>
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

/**
 * Écrans qui gardent la barre d'onglets. Exportée pour que les écrans sachent
 * si la marge de sécurité basse est déjà consommée par la barre.
 */
export function isBottomNavigationVisible(pathname: string): boolean {
  return (
    NAV_ITEMS.some(({ href }) => pathname === href) ||
    pathname === '/preparations/new' ||
    pathname === '/inventory/new'
  );
}

/**
 * `badges` porte les destinations qui réclament l'attention. La barre reste
 * ignorante de ce qui les motive : elle affiche une pastille, la raison
 * appartient à qui la lui passe.
 */
export function BottomNavigation({
  badges,
}: Readonly<{ badges?: ReadonlySet<string> }> = {}) {
  const pathname = usePathname();
  if (!isBottomNavigationVisible(pathname)) return null;
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
              <View
                accessibilityElementsHidden
                style={[styles.navIconArea, selected && styles.navIconActive]}
              >
                <NavigationIcon
                  kind={item.href}
                  color={selected ? colors.brandPressed : colors.textTertiary}
                />
                {badges?.has(item.href) ? (
                  <View style={styles.navBadge} />
                ) : null}
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
  const insets = useSafeAreaInsets();
  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={onCancel}
    >
      <View style={styles.modalOverlay}>
        <View
          accessibilityViewIsModal
          style={[styles.modal, { paddingBottom: insets.bottom + 26 }]}
        >
          <View accessibilityElementsHidden style={styles.modalHandle} />
          <Text accessibilityRole="header" style={typography.stackTitle}>
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
  danger: { borderColor: colors.destructive, borderWidth: 1.5 },
  quiet: { backgroundColor: 'transparent' },
};
const pressedStyles: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: colors.brandPressed },
  danger: { backgroundColor: colors.destructive },
  quiet: { backgroundColor: colors.surfaceMuted },
};
const buttonTextStyles: Record<ButtonVariant, TextStyle> = {
  primary: { color: colors.onDark },
  danger: { color: colors.destructive },
  quiet: { color: colors.brand },
};
const messageStyles = {
  info: { backgroundColor: colors.brandSoft },
  success: { backgroundColor: colors.successSoft },
  warning: { backgroundColor: colors.warningSoft },
  error: { backgroundColor: colors.destructiveSoft },
};
const messageTextStyles = {
  info: { color: colors.brandPressed },
  success: { color: colors.success },
  warning: { color: colors.warning },
  error: { color: colors.destructive },
};

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  fixedHeader: {
    alignSelf: 'center',
    backgroundColor: colors.background,
    gap: 12,
    maxWidth: sizes.screenMaxWidth,
    paddingHorizontal: layout.screenPadding,
    paddingTop: 6,
    width: '100%',
  },
  screenContent: {
    alignSelf: 'center',
    flexGrow: 1,
    gap: layout.sectionGap,
    maxWidth: sizes.screenMaxWidth,
    paddingBottom: 22,
    paddingHorizontal: layout.screenPadding,
    paddingTop: layout.sectionGap,
    width: '100%',
  },
  stickyFooter: {
    backgroundColor: colors.surface,
    borderTopColor: colors.cardBorder,
    borderTopWidth: 1,
    padding: 12,
  },
  button: {
    alignItems: 'center',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  buttonDisabled: {
    backgroundColor: colors.disabled,
    borderColor: colors.disabled,
  },
  buttonText: { ...typography.buttonLabel, textAlign: 'center' },
  buttonTextDisabled: { color: colors.disabledText },
  field: { gap: 6 },
  label: {
    color: colors.text,
    fontSize: 13.5,
    fontWeight: '700',
    lineHeight: 18,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.cardBorder,
    borderRadius: radii.tile,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14.5,
    fontWeight: '600',
    minHeight: sizes.minTouch,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  inputError: { borderColor: colors.destructive, borderWidth: 1.5 },
  fieldError: { ...typography.micro, color: colors.destructive },
  help: typography.micro,
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.cardBorder,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: 11,
    padding: 16,
  },
  cardMuted: { backgroundColor: colors.surfaceMuted, borderWidth: 0 },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 11, fontWeight: '700', lineHeight: 14 },
  message: {
    borderRadius: radii.banner,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  messageContent: { flex: 1, gap: 3 },
  messageTitle: { fontSize: 13, fontWeight: '700', lineHeight: 17 },
  messageBody: { fontSize: 12.5, fontWeight: '500', lineHeight: 18 },
  empty: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 28,
  },
  emptyTitle: { ...typography.cardTitle, textAlign: 'center' },
  loading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'center',
    padding: 22,
  },
  sectionTitle: typography.sectionLabel,
  selectButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.cardBorder,
    borderRadius: radii.tile,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: sizes.minTouch,
    paddingHorizontal: 14,
  },
  selectText: {
    color: colors.text,
    flex: 1,
    fontSize: 14.5,
    fontWeight: '600',
  },
  selectMuted: { color: colors.textTertiary, fontWeight: '500' },
  selectChevron: { color: colors.textTertiary, fontSize: 20 },
  selectMenu: {
    backgroundColor: colors.surface,
    borderColor: colors.cardBorder,
    borderRadius: radii.card,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 4,
  },
  selectOption: {
    alignItems: 'center',
    borderRadius: radii.tile,
    flexDirection: 'row',
    minHeight: sizes.minTouch,
    paddingHorizontal: 12,
  },
  selectOptionSelected: { backgroundColor: colors.brandSoft },
  selectOptionText: {
    color: colors.text,
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  selectOptionTextSelected: { color: colors.brandPressed, fontWeight: '700' },
  selectCheck: { color: colors.brand, fontSize: 16, fontWeight: '800' },
  modalOverlay: {
    backgroundColor: colors.overlay,
    flex: 1,
    justifyContent: 'flex-end',
  },
  modal: {
    alignSelf: 'center',
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    gap: 12,
    maxWidth: 520,
    paddingHorizontal: 20,
    paddingTop: 14,
    width: '100%',
  },
  modalHandle: {
    alignSelf: 'center',
    backgroundColor: colors.border,
    borderRadius: radii.pill,
    height: 4,
    marginBottom: 2,
    width: 38,
  },
  navigationSafeArea: {
    backgroundColor: colors.surface,
    borderTopColor: colors.cardBorder,
    borderTopWidth: 1,
  },
  bottomNavigation: {
    alignSelf: 'center',
    flexDirection: 'row',
    maxWidth: sizes.screenMaxWidth,
    paddingBottom: 14,
    paddingHorizontal: 10,
    paddingTop: 8,
    width: '100%',
  },
  navItem: {
    alignItems: 'center',
    gap: 4,
    justifyContent: 'center',
    minHeight: sizes.minTouch,
    minWidth: 0,
    width: '25%',
  },
  navItemPressed: { opacity: 0.72 },
  navIconArea: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 28,
    justifyContent: 'center',
    width: 52,
  },
  navIconActive: { backgroundColor: colors.brandSoft },
  navBadge: {
    backgroundColor: colors.accent,
    borderColor: colors.surface,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    height: 8,
    position: 'absolute',
    right: 12,
    top: 2,
    width: 8,
  },
  navLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 13,
    maxWidth: '100%',
    textAlign: 'center',
  },
  navTextSelected: { color: colors.brandPressed, fontWeight: '700' },
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
