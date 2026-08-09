import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';

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
  style?: ViewStyle;
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

export function Screen({
  children,
  scroll = true,
  stickyFooter,
}: {
  children: ReactNode;
  scroll?: boolean;
  stickyFooter?: ReactNode;
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
      {content}
      {stickyFooter ? (
        <View style={styles.stickyFooter}>{stickyFooter}</View>
      ) : null}
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
});
