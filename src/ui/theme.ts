import type { TextStyle } from 'react-native';

/**
 * Rampes de la refonte mobile. Les cinq couleurs de marque sont inchangées ;
 * seuls les paliers intermédiaires sont nouveaux. Les écrans passent par
 * `colors`, qui nomme les rôles ; la rampe brute sert aux surfaces qui n'ont
 * pas de rôle stable (dégradés de gravité, cases du pilulier).
 */
export const palette = {
  green: {
    100: '#F2F7F4',
    200: '#E5EFE9',
    300: '#C7DDD2',
    400: '#9CBFB0',
    500: '#376B5B',
    600: '#285144',
    700: '#17332B',
  },
  coral: {
    100: '#FBEDE6',
    300: '#E08A65',
    500: '#C96B4B',
    600: '#A85436',
    700: '#8F462E',
  },
  neutral: {
    0: '#FFFDF9',
    100: '#FAF7F0',
    200: '#F3EFE6',
    250: '#F1EDE3',
    300: '#E8E2D6',
    400: '#DDD8CD',
    600: '#918F86',
    700: '#5E6B66',
    900: '#24322D',
  },
} as const;

export const colors = {
  brand: palette.green[500],
  brandPressed: palette.green[600],
  brandSoft: palette.green[200],
  brandTint: palette.green[100],
  accent: palette.coral[500],
  accentPressed: palette.coral[600],
  background: palette.neutral[100],
  surface: palette.neutral[0],
  surfaceMuted: palette.neutral[200],
  text: palette.neutral[900],
  textMuted: palette.neutral[700],
  textTertiary: palette.neutral[600],
  border: palette.neutral[400],
  /** Bordure des cartes et des listes de la refonte. */
  cardBorder: palette.neutral[300],
  /** Filet de séparation à l'intérieur d'une liste, et piste de barre. */
  hairline: palette.neutral[250],
  /** En-tête sombre : une seule surface porte l'action du moment. */
  headerDark: palette.green[700],
  onDark: palette.neutral[0],
  onDarkSoft: palette.green[300],
  onDarkMuted: palette.green[400],
  accentOnDark: palette.coral[300],
  /** Case du pilulier : à préparer, puis prête. */
  gridPending: palette.green[300],
  gridReady: palette.green[500],
  success: '#176B45',
  successSoft: '#E8F6EE',
  warning: '#875A00',
  warningSoft: '#FFF5D6',
  danger: '#A1262F',
  dangerSoft: '#FDECEF',
  /** Actions destructives et gravité « insuffisant » de la refonte. */
  destructive: palette.coral[700],
  destructiveSoft: palette.coral[100],
  /** Segment « ignorées » des statistiques. */
  skipped: '#E0A93A',
  disabled: '#D8E0DD',
  disabledText: '#687570',
  overlay: 'rgba(13, 27, 23, 0.55)',
} as const;

/**
 * Voiles posés sur l'en-tête sombre : panneau, filets et contrôles y sont
 * dessinés par transparence pour rester solidaires du vert profond.
 */
export const onDarkSurfaces = {
  panel: 'rgba(255, 253, 249, 0.07)',
  panelBorder: 'rgba(255, 253, 249, 0.13)',
  hairline: 'rgba(255, 253, 249, 0.10)',
  control: 'rgba(255, 253, 249, 0.10)',
  checkbox: 'rgba(255, 253, 249, 0.32)',
  cell: 'rgba(255, 253, 249, 0.04)',
  cellBorder: 'rgba(255, 253, 249, 0.16)',
} as const;

/**
 * Tonalité d'un toast : elle se lit à l'icône seule. Le fond reste toujours
 * `colors.headerDark`, de sorte que la surface soit reconnaissable comme la
 * voix « système » de l'application quel que soit le message.
 */
export const toastToneColors = {
  success: palette.green[400],
  info: palette.green[300],
  /** Sans équivalent dans les rampes : aucun jaune n'y tient sur fond sombre. */
  warning: '#F5DFA0',
  error: palette.coral[300],
} as const;

/**
 * Échelle de gravité commune aux alertes, au stock et aux listes de
 * renouvellement : une seule lecture des couleurs dans toute l'application.
 */
export const severity = {
  high: { text: colors.destructive, background: colors.destructiveSoft },
  warning: { text: colors.warning, background: colors.warningSoft },
  ok: { text: colors.brand, background: colors.brandSoft },
  neutral: { text: colors.textMuted, background: colors.surfaceMuted },
} as const;

export type SeverityLevel = keyof typeof severity;

export const spacing = {
  sm: 8,
  md: 12,
  lg: 16,
} as const;

/** Marges et écarts de la refonte, exprimés une seule fois. */
export const layout = {
  screenPadding: 20,
  sectionGap: 18,
} as const;

export const radii = {
  /** Case du pilulier. */
  cell: 3,
  /** Case de la grille de préparation. */
  cellLarge: 7,
  sm: 10,
  tile: 12,
  md: 14,
  banner: 16,
  /** Listes et cartes. */
  card: 18,
  /** Feuille modale remontante. */
  sheet: 26,
  /** Carte principale. */
  hero: 28,
  /** Arrondi bas d'un en-tête sombre. */
  headerCurve: 30,
  pill: 999,
} as const;
export const sizes = { minTouch: 44, screenMaxWidth: 720 } as const;

export const typography = {
  label: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  } satisfies TextStyle,
  caption: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  } satisfies TextStyle,

  /**
   * Échelle de la refonte mobile. Une seule famille : la police système, car
   * aucune police d'affichage testée ne couvre les caractères
   * pharmaceutiques (`µ`, `½`).
   */
  hero: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.68,
    lineHeight: 34,
  } satisfies TextStyle,
  screenTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.56,
    lineHeight: 29,
  } satisfies TextStyle,
  stackTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 23,
  } satisfies TextStyle,
  cardTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 19,
  } satisfies TextStyle,
  itemTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 19,
  } satisfies TextStyle,
  /** Étiquette de section et eyebrow : mêmes valeurs, couleur adaptée au fond. */
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.37,
    lineHeight: 13,
    textTransform: 'uppercase',
  } satisfies TextStyle,
  detail: {
    color: colors.textMuted,
    fontSize: 12.5,
    fontWeight: '500',
    lineHeight: 17,
  } satisfies TextStyle,
  micro: {
    color: colors.textTertiary,
    fontSize: 11.5,
    fontWeight: '500',
    lineHeight: 15,
  } satisfies TextStyle,
  numeric: {
    color: colors.text,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
  } satisfies TextStyle,
  buttonLabel: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 16,
  } satisfies TextStyle,
} as const;
