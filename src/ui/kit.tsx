import { createContext, useContext, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';
import { router, usePathname, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isBottomNavigationVisible } from './components';

import { ChevronIcon, PlusIcon, SearchIcon } from './icons';
import {
  colors,
  layout,
  onDarkSurfaces,
  radii,
  severity as severityScale,
  sizes,
  spacing,
  typography,
  type SeverityLevel,
} from './theme';

/**
 * Trousse de la refonte mobile. Chaque écran est un en-tête fixe et une
 * colonne défilante ; le reste de l'interface est fait de listes denses à
 * filets fins, de pastilles et de tuiles. Ces primitives portent les valeurs
 * du handoff une seule fois, pour qu'aucun écran ne les redéclare.
 */

export function AppScreen({
  header,
  children,
  footer,
  floatingAction,
  bodyStyle,
  insetColor = colors.background,
}: Readonly<{
  header?: ReactNode;
  children: ReactNode;
  /** Barre d'actions posée sous la colonne défilante. */
  footer?: ReactNode;
  /** Bouton flottant, superposé au contenu : la colonne lui réserve sa place. */
  floatingAction?: ReactNode;
  bodyStyle?: StyleProp<ViewStyle>;
  /**
   * Couleur de la bande sous la barre d'état, quand l'en-tête n'est pas sur
   * le fond d'écran habituel (en-tête vert profond).
   */
  insetColor?: string;
}>) {
  const insets = useSafeAreaInsets();
  // La barre d'onglets consomme déjà la marge basse ; sans elle, l'écran
  // descend jusqu'au bord physique et doit la reprendre à son compte.
  const bottomInset = isBottomNavigationVisible(usePathname())
    ? 0
    : insets.bottom;
  return (
    <View style={styles.screen}>
      <View style={{ backgroundColor: insetColor, height: insets.top }} />
      {header}
      <ScrollView
        contentContainerStyle={[
          styles.body,
          floatingAction !== undefined && styles.bodyWithFloatingAction,
          bodyStyle,
        ]}
        keyboardShouldPersistTaps="handled"
        style={styles.bodyScroll}
      >
        {children}
      </ScrollView>
      {footer !== undefined ? (
        <View style={[styles.footer, { paddingBottom: bottomInset + 14 }]}>
          {footer}
        </View>
      ) : null}
      {floatingAction !== undefined ? (
        <View
          pointerEvents="box-none"
          style={[styles.floatingSlot, { bottom: bottomInset + 16 }]}
        >
          {floatingAction}
        </View>
      ) : null}
    </View>
  );
}

/** En-tête d'un écran d'onglet : titre large, sans bouton retour. */
export function TabHeader({
  title,
  subtitle,
  action,
}: Readonly<{ title: string; subtitle?: string; action?: ReactNode }>) {
  return (
    <View style={styles.tabHeader}>
      <View style={styles.headerText}>
        <Text accessibilityRole="header" style={typography.screenTitle}>
          {title}
        </Text>
        {subtitle ? <Text style={typography.detail}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

/** En-tête d'un écran empilé : bouton retour rond, titre, sous-titre. */
export function StackHeader({
  title,
  subtitle,
  right,
  onBack,
}: Readonly<{
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onBack?: () => void;
}>) {
  return (
    <View style={styles.stackHeader}>
      <Pressable
        accessibilityLabel="Revenir à l’écran précédent"
        accessibilityRole="button"
        onPress={onBack ?? (() => router.back())}
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
      >
        <View style={styles.backChevron}>
          <ChevronIcon color={colors.text} size={17} />
        </View>
      </Pressable>
      <View style={styles.headerText}>
        <Text accessibilityRole="header" style={typography.stackTitle}>
          {title}
        </Text>
        {subtitle ? <Text style={typography.detail}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function SectionLabel({
  children,
  aside,
}: Readonly<{ children: ReactNode; aside?: ReactNode }>) {
  if (aside === undefined) {
    return (
      <Text accessibilityRole="header" style={typography.sectionLabel}>
        {children}
      </Text>
    );
  }
  return (
    <View style={styles.sectionHead}>
      <Text accessibilityRole="header" style={typography.sectionLabel}>
        {children}
      </Text>
      {typeof aside === 'string' ? (
        <Text style={styles.sectionAside}>{aside}</Text>
      ) : (
        aside
      )}
    </View>
  );
}

/**
 * Étiquette de section et contenu qu'elle annonce, groupés. Sans cette
 * enveloppe, la colonne de `AppScreen` espace l'étiquette de sa liste autant
 * que de la section suivante, et le groupement se perd.
 */
export function Section({
  label,
  aside,
  children,
}: Readonly<{ label?: string; aside?: ReactNode; children: ReactNode }>) {
  return (
    <View style={styles.section}>
      {label !== undefined ? (
        <SectionLabel aside={aside}>{label}</SectionLabel>
      ) : null}
      {children}
    </View>
  );
}

type ListTone = 'surface' | 'muted';

/**
 * Le filet de séparation dépend du fond de la liste : sur la surface crème il
 * reste très clair, sur le fond beige des listes secondaires il doit foncer
 * pour rester visible. La liste l'annonce à ses lignes plutôt que de laisser
 * chaque appelant y penser.
 */
const ListToneContext = createContext<ListTone>('surface');

/** Surface unique découpée par des filets : la liste de base de la refonte. */
export function DenseList({
  children,
  tone = 'surface',
}: Readonly<{ children: ReactNode; tone?: ListTone }>) {
  return (
    <ListToneContext.Provider value={tone}>
      <View style={[styles.list, tone === 'muted' && styles.listMuted]}>
        {children}
      </View>
    </ListToneContext.Provider>
  );
}

export function DenseRow({
  title,
  detail,
  leading,
  trailing,
  chevron = false,
  first = false,
  href,
  onPress,
  disabled = false,
  accessibilityLabel,
}: Readonly<{
  title: ReactNode;
  detail?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  first?: boolean;
  href?: Href;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}>) {
  const divider =
    useContext(ListToneContext) === 'muted'
      ? styles.rowDividedMuted
      : styles.rowDivided;
  const content = (
    <>
      {leading}
      <View style={styles.rowText}>
        {typeof title === 'string' ? (
          <Text style={styles.rowTitle}>{title}</Text>
        ) : (
          title
        )}
        {typeof detail === 'string' ? (
          <Text style={styles.rowDetail}>{detail}</Text>
        ) : (
          detail
        )}
      </View>
      {trailing}
      {chevron ? <ChevronIcon color={colors.textTertiary} size={17} /> : null}
    </>
  );
  if (href === undefined && onPress === undefined) {
    return <View style={[styles.row, !first && divider]}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={
        onPress ??
        (href === undefined ? undefined : () => router.navigate(href))
      }
      style={({ pressed }) => [
        styles.row,
        !first && divider,
        pressed && styles.rowPressed,
        disabled && styles.rowDisabled,
      ]}
    >
      {content}
    </Pressable>
  );
}

/** Carte cliquable : la seule forme qui subsiste là où un élément vit seul. */
export function AppCard({
  children,
  href,
  onPress,
  tone = 'surface',
  style,
  accessibilityLabel,
}: Readonly<{
  children: ReactNode;
  href?: Href;
  onPress?: () => void;
  tone?: 'surface' | 'muted';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}>) {
  const cardStyle = [
    styles.card,
    tone === 'muted' && styles.cardMuted,
    style,
  ] as StyleProp<ViewStyle>;
  if (href === undefined && onPress === undefined) {
    return <View style={cardStyle}>{children}</View>;
  }
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={
        onPress ??
        (href === undefined ? undefined : () => router.navigate(href))
      }
      style={({ pressed }) => [cardStyle, pressed && styles.cardPressed]}
    >
      {children}
    </Pressable>
  );
}

export type PillOption<Value extends string> = Readonly<{
  value: Value;
  label: string;
}>;

/**
 * Pastilles de filtre. Hauteur et `boxSizing` identiques dans les deux états :
 * la mise en page ne doit pas sauter au changement de sélection.
 *
 * Toujours sur une seule ligne : un filtre qui passe à la ligne se lit comme
 * deux groupes distincts. Les pastilles gardent leur largeur naturelle tant
 * qu'elles tiennent, puis se resserrent, le libellé rétrécissant plutôt que de
 * se tronquer.
 */
export function FilterPills<Value extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: Readonly<{
  options: readonly PillOption<Value>[];
  value: Value;
  onChange(value: Value): void;
  accessibilityLabel?: string;
}>) {
  return (
    <View accessibilityLabel={accessibilityLabel} style={styles.pillRow}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityLabel={option.label}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.pill,
              selected ? styles.pillSelected : styles.pillIdle,
              pressed && styles.pressed,
            ]}
          >
            <Text
              adjustsFontSizeToFit
              maxFontSizeMultiplier={1.2}
              minimumFontScale={0.8}
              numberOfLines={1}
              style={[
                styles.pillText,
                selected ? styles.pillTextSelected : styles.pillTextIdle,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Choix binaire pleine largeur (source d'une boîte, type de posologie). */
export function ChoicePills<Value extends string>({
  options,
  value,
  onChange,
  height = 44,
}: Readonly<{
  options: readonly PillOption<Value>[];
  value: Value | null;
  onChange(value: Value): void;
  height?: number;
}>) {
  return (
    <View style={styles.pillRow}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityLabel={option.label}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.choicePill,
              { height },
              selected ? styles.choicePillSelected : styles.choicePillIdle,
              pressed && styles.pressed,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.choicePillText,
                selected
                  ? styles.choicePillTextSelected
                  : styles.choicePillTextIdle,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SearchField({
  help,
  ...props
}: TextInputProps & { help?: string }) {
  return (
    <View style={styles.searchWrapper}>
      <View style={styles.search}>
        <SearchIcon color={colors.textTertiary} size={17} strokeWidth={2} />
        <TextInput
          placeholderTextColor={colors.textTertiary}
          {...props}
          style={[styles.searchInput, props.style]}
        />
      </View>
      {help ? <Text style={styles.searchHelp}>{help}</Text> : null}
    </View>
  );
}

export function Tile({
  label,
  value,
  tone = 'muted',
  style,
}: Readonly<{
  label: string;
  value: ReactNode;
  tone?: 'muted' | 'tint' | 'surface';
  style?: StyleProp<ViewStyle>;
}>) {
  return (
    <View style={[styles.tile, tileTones[tone], style]}>
      <Text style={styles.tileLabel}>{label}</Text>
      {typeof value === 'string' ? (
        <Text style={styles.tileValue}>{value}</Text>
      ) : (
        value
      )}
    </View>
  );
}

export function TileRow({ children }: Readonly<{ children: ReactNode }>) {
  return <View style={styles.tileRow}>{children}</View>;
}

/** Bandeau coloré par gravité : la hiérarchie passe par la surface. */
export function Banner({
  children,
  level = 'neutral',
  icon,
  title,
  compact = false,
}: Readonly<{
  children: ReactNode;
  level?: SeverityLevel;
  icon?: ReactNode;
  title?: string;
  /**
   * Une seule ligne, icône et texte alignés : un constat, pas un paragraphe.
   * Le texte y prend le poids d'un titre, puisqu'il en tient lieu.
   */
  compact?: boolean;
}>) {
  const tone = severityScale[level];
  return (
    <View
      style={[
        styles.banner,
        compact && styles.bannerCompact,
        { backgroundColor: tone.background },
      ]}
    >
      {icon}
      <View style={styles.bannerText}>
        {title ? (
          <Text style={[styles.bannerTitle, { color: tone.text }]}>
            {title}
          </Text>
        ) : null}
        <Text
          style={[
            compact ? styles.bannerTitle : styles.bannerBody,
            { color: tone.text },
          ]}
        >
          {children}
        </Text>
      </View>
    </View>
  );
}

export function SeverityBadge({
  label,
  level,
}: Readonly<{ label: string; level: SeverityLevel }>) {
  const tone = severityScale[level];
  return (
    <View style={[styles.badge, { backgroundColor: tone.background }]}>
      <Text style={[styles.badgeText, { color: tone.text }]}>{label}</Text>
    </View>
  );
}

/** Étiquette neutre et compacte : CIS, forme pharmaceutique, origine. */
export function MetaBadge({ label }: Readonly<{ label: string }>) {
  return (
    <View style={styles.metaBadge}>
      <Text style={styles.metaBadgeText}>{label}</Text>
    </View>
  );
}

/** Barre de couverture : piste neutre, remplissage à la couleur de gravité. */
export function ProgressBar({
  ratio,
  color = colors.brand,
  height = 5,
}: Readonly<{ ratio: number; color?: string; height?: number }>) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  return (
    <View accessibilityElementsHidden style={[styles.track, { height }]}>
      <View
        style={{
          backgroundColor: color,
          borderRadius: radii.pill,
          height,
          width: `${clamped * 100}%`,
        }}
      />
    </View>
  );
}

export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max,
  format,
  label,
  disabled = false,
}: Readonly<{
  value: number;
  onChange(value: number): void;
  step?: number;
  min?: number;
  max?: number;
  format?: (value: number) => string;
  label: string;
  disabled?: boolean;
}>) {
  const decrease = () => onChange(Math.max(min, round(value - step)));
  const increase = () =>
    onChange(
      max === undefined
        ? round(value + step)
        : Math.min(max, round(value + step)),
    );
  return (
    <View style={styles.stepper}>
      <StepperButton
        accessibilityLabel={`Diminuer ${label}`}
        disabled={disabled || value <= min}
        onPress={decrease}
        symbol="−"
      />
      <Text
        accessibilityLabel={`${label} : ${format ? format(value) : value}`}
        style={styles.stepperValue}
      >
        {format ? format(value) : value}
      </Text>
      <StepperButton
        accessibilityLabel={`Augmenter ${label}`}
        disabled={disabled || (max !== undefined && value >= max)}
        onPress={increase}
        symbol="+"
      />
    </View>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function StepperButton({
  symbol,
  onPress,
  disabled,
  accessibilityLabel,
}: Readonly<{
  symbol: string;
  onPress(): void;
  disabled: boolean;
  accessibilityLabel: string;
}>) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.stepperButton,
        pressed && styles.stepperButtonPressed,
        disabled && styles.stepperButtonDisabled,
      ]}
    >
      <Text
        style={[styles.stepperSymbol, disabled && styles.stepperSymbolDisabled]}
      >
        {symbol}
      </Text>
    </Pressable>
  );
}

export function Toggle({
  value,
  onChange,
  label,
  help,
  disabled = false,
}: Readonly<{
  value: boolean;
  onChange(value: boolean): void;
  label: string;
  help?: string;
  disabled?: boolean;
}>) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={({ pressed }) => [styles.toggleRow, pressed && styles.rowPressed]}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{label}</Text>
        {help ? <Text style={styles.rowDetail}>{help}</Text> : null}
      </View>
      <View style={[styles.track46, value && styles.track46On]}>
        <View style={[styles.knob, value && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

export type ButtonTone =
  | 'brand'
  | 'accent'
  | 'outline'
  | 'destructive'
  /** Sur fond vert profond : corail plein, texte sombre. */
  | 'onDark'
  /** Sur fond vert profond : contour clair. */
  | 'onDarkOutline';

/** Bouton de la refonte : toujours une pilule, jamais d'ombre. */
export function PillButton({
  label,
  onPress,
  tone = 'brand',
  height = 52,
  disabled = false,
  icon,
  accessibilityHint,
}: Readonly<{
  label: string;
  onPress(): void;
  tone?: ButtonTone;
  height?: number;
  disabled?: boolean;
  icon?: ReactNode;
  accessibilityHint?: string;
}>) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pillButton,
        { minHeight: height },
        buttonTones[tone],
        pressed && !disabled && buttonPressedTones[tone],
        disabled && styles.pillButtonDisabled,
      ]}
    >
      {({ pressed }) => (
        <>
          {icon}
          <Text
            style={[
              styles.pillButtonText,
              buttonTextTones[tone],
              pressed && !disabled ? buttonPressedTextTones[tone] : null,
              disabled && styles.pillButtonTextDisabled,
            ]}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/** Bouton flottant corail : la seule surface qui porte encore une ombre. */
/**
 * Action principale d'un écran d'onglet : pastille terracotta posée en bas à
 * droite, au-dessus de la barre d'onglets. Elle se dimensionne à son contenu —
 * une pastille pleine largeur se lirait comme une barre d'actions et non comme
 * un raccourci superposé au contenu.
 *
 * Le « + » est porté par l'icône : `label` ne dit que la destination, en
 * petites majuscules pour qu'il forme un bloc avec elle plutôt qu'un mot
 * capitalisé posé à côté.
 */
export function FloatingAction({
  label,
  accessibilityLabel,
  href,
  onPress,
}: Readonly<{
  label: string;
  /** Phrase complète pour la synthèse vocale, que « + » ne porte pas. */
  accessibilityLabel: string;
  href?: Href;
  onPress?: () => void;
}>) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={
        onPress ??
        (href === undefined ? undefined : () => router.navigate(href))
      }
      style={({ pressed }) => [
        styles.floating,
        pressed && styles.floatingPressed,
      ]}
    >
      <PlusIcon color={colors.onDark} size={17} strokeWidth={2.4} />
      <Text style={styles.floatingText}>{label}</Text>
    </Pressable>
  );
}

export function SegmentedControl<Value extends string>({
  options,
  value,
  onChange,
}: Readonly<{
  options: readonly PillOption<Value>[];
  value: Value;
  onChange(value: Value): void;
}>) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityLabel={option.label}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            <Text
              style={[
                styles.segmentText,
                selected && styles.segmentTextSelected,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const tileTones = {
  muted: { backgroundColor: colors.background },
  tint: { backgroundColor: colors.brandTint },
  surface: { backgroundColor: colors.surface },
};
const buttonTones: Record<ButtonTone, ViewStyle> = {
  brand: { backgroundColor: colors.brand },
  accent: { backgroundColor: colors.accent },
  outline: { borderColor: colors.brand, borderWidth: 1.5 },
  destructive: { borderColor: colors.destructive, borderWidth: 1.5 },
  onDark: { backgroundColor: colors.accentOnDark },
  onDarkOutline: { borderColor: colors.onDarkMuted, borderWidth: 1.5 },
};
const buttonPressedTones: Record<ButtonTone, ViewStyle> = {
  brand: { backgroundColor: colors.brandPressed },
  accent: { backgroundColor: colors.accentPressed },
  outline: { backgroundColor: colors.brand },
  destructive: { backgroundColor: colors.destructive },
  onDark: { backgroundColor: colors.accent },
  onDarkOutline: { backgroundColor: onDarkSurfaces.control },
};
const buttonTextTones: Record<ButtonTone, { color: string }> = {
  brand: { color: colors.onDark },
  accent: { color: colors.onDark },
  outline: { color: colors.brand },
  destructive: { color: colors.destructive },
  onDark: { color: colors.headerDark },
  onDarkOutline: { color: colors.onDarkSoft },
};
const buttonPressedTextTones: Record<ButtonTone, { color: string }> = {
  brand: { color: colors.onDark },
  accent: { color: colors.onDark },
  outline: { color: colors.onDark },
  destructive: { color: colors.onDark },
  onDark: { color: colors.onDark },
  onDarkOutline: { color: colors.onDark },
};

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  bodyScroll: { flex: 1, minHeight: 0 },
  body: {
    gap: layout.sectionGap,
    paddingBottom: 22,
    paddingHorizontal: layout.screenPadding,
    paddingTop: 16,
  },
  /** Place réservée sous la colonne pour ne pas passer sous le bouton flottant. */
  bodyWithFloatingAction: { paddingBottom: 84 },
  tabHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingBottom: 14,
    paddingHorizontal: layout.screenPadding,
    paddingTop: 14,
  },
  stackHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingBottom: 14,
    paddingHorizontal: layout.screenPadding,
    paddingTop: 10,
  },
  headerText: { flex: 1, gap: 3, minWidth: 0 },
  backButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.pill,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  backChevron: { transform: [{ rotate: '180deg' }] },
  section: { gap: 11 },
  sectionHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionAside: {
    ...typography.numeric,
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 13,
  },
  list: {
    backgroundColor: colors.surface,
    borderColor: colors.cardBorder,
    borderRadius: radii.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  listMuted: { backgroundColor: colors.surfaceMuted, borderWidth: 0 },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11,
    minHeight: sizes.minTouch,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowDivided: { borderTopColor: colors.hairline, borderTopWidth: 1 },
  rowDividedMuted: { borderTopColor: colors.cardBorder, borderTopWidth: 1 },
  rowPressed: { backgroundColor: colors.background },
  rowDisabled: { opacity: 0.5 },
  rowText: { flex: 1, gap: 3, minWidth: 0 },
  rowTitle: typography.itemTitle,
  rowDetail: typography.detail,
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.cardBorder,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: 11,
    padding: 16,
  },
  cardMuted: { backgroundColor: colors.surfaceMuted, borderWidth: 0 },
  cardPressed: { borderColor: colors.gridPending },
  pillRow: { flexDirection: 'row', gap: 7 },
  pill: {
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexShrink: 1,
    height: 34,
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: 12,
  },
  pillSelected: {
    backgroundColor: colors.headerDark,
    borderColor: colors.headerDark,
  },
  pillIdle: { backgroundColor: colors.surface, borderColor: colors.cardBorder },
  pillText: { fontSize: 12.5, lineHeight: 15 },
  pillTextSelected: { color: colors.onDark, fontWeight: '700' },
  pillTextIdle: { color: colors.textMuted, fontWeight: '600' },
  choicePill: {
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1.5,
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: 12,
  },
  choicePillSelected: {
    backgroundColor: colors.headerDark,
    borderColor: colors.headerDark,
  },
  choicePillIdle: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  choicePillText: { fontSize: 12.5, fontWeight: '700', lineHeight: 15 },
  choicePillTextSelected: { color: colors.onDark },
  choicePillTextIdle: { color: colors.textMuted },
  searchWrapper: { gap: 6 },
  search: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.cardBorder,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    minHeight: 42,
    paddingHorizontal: 16,
  },
  searchInput: {
    color: colors.text,
    flex: 1,
    fontSize: 14.5,
    fontWeight: '600',
    paddingVertical: 10,
  },
  searchHelp: { ...typography.micro, paddingHorizontal: 16 },
  tileRow: { flexDirection: 'row', gap: 9 },
  tile: {
    borderRadius: radii.tile,
    flex: 1,
    gap: 5,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  tileLabel: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.9,
    lineHeight: 12,
    textTransform: 'uppercase',
  },
  tileValue: {
    ...typography.numeric,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 18,
  },
  banner: {
    alignItems: 'flex-start',
    borderRadius: radii.banner,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bannerCompact: { alignItems: 'center', paddingVertical: 11 },
  bannerText: { flex: 1, gap: 3, minWidth: 0 },
  bannerTitle: { fontSize: 13, fontWeight: '700', lineHeight: 17 },
  bannerBody: { fontSize: 12.5, fontWeight: '500', lineHeight: 18 },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 11, fontWeight: '700', lineHeight: 14 },
  metaBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  metaBadgeText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  track: {
    backgroundColor: colors.hairline,
    borderRadius: radii.pill,
    overflow: 'hidden',
    width: '100%',
  },
  stepper: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  stepperButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  stepperButtonPressed: { backgroundColor: colors.surfaceMuted },
  stepperButtonDisabled: { opacity: 0.4 },
  stepperSymbol: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 22,
  },
  stepperSymbolDisabled: { color: colors.textTertiary },
  stepperValue: {
    ...typography.numeric,
    fontSize: 19,
    lineHeight: 22,
    minWidth: 48,
    textAlign: 'center',
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: sizes.minTouch,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  track46: {
    backgroundColor: colors.border,
    borderRadius: radii.pill,
    height: 28,
    justifyContent: 'center',
    padding: 3,
    width: 46,
  },
  track46On: { backgroundColor: colors.brand },
  knob: {
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    height: 22,
    width: 22,
  },
  knobOn: { alignSelf: 'flex-end' },
  pillButton: {
    alignItems: 'center',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: 12,
  },
  pillButtonDisabled: {
    backgroundColor: colors.disabled,
    borderColor: colors.disabled,
  },
  pillButtonText: { ...typography.buttonLabel, textAlign: 'center' },
  pillButtonTextDisabled: { color: colors.disabledText },
  floatingSlot: {
    alignItems: 'flex-end',
    left: layout.screenPadding,
    position: 'absolute',
    right: layout.screenPadding,
  },
  footer: {
    backgroundColor: colors.background,
    borderTopColor: colors.cardBorder,
    borderTopWidth: 1,
    gap: 9,
    paddingHorizontal: layout.screenPadding,
    paddingTop: 12,
  },
  floating: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    elevation: 6,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 20,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.34,
    shadowRadius: 20,
  },
  floatingPressed: { backgroundColor: colors.accentPressed },
  floatingText: {
    color: colors.onDark,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.9,
    lineHeight: 16,
    textTransform: 'uppercase',
  },
  segmented: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.pill,
    flexDirection: 'row',
    padding: 3,
  },
  segment: {
    alignItems: 'center',
    borderRadius: radii.pill,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 9,
  },
  segmentSelected: {
    backgroundColor: colors.surface,
    elevation: 1,
    shadowColor: '#17201E',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  segmentText: {
    color: colors.textMuted,
    fontSize: 12.5,
    fontWeight: '600',
    lineHeight: 15,
  },
  segmentTextSelected: { color: colors.text, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});
