import type { TextStyle, ViewStyle } from 'react-native';

export const colors = {
  brand: '#376B5B',
  brandPressed: '#285144',
  brandSoft: '#E5EFE9',
  accent: '#C96B4B',
  accentSoft: '#FBEDE6',
  background: '#FAF7F0',
  surface: '#FFFDF9',
  surfaceMuted: '#F3EFE6',
  text: '#24322D',
  textMuted: '#5E6B66',
  border: '#DDD8CD',
  borderStrong: '#918F86',
  success: '#176B45',
  successSoft: '#E8F6EE',
  warning: '#875A00',
  warningSoft: '#FFF5D6',
  danger: '#A1262F',
  dangerPressed: '#7F1D25',
  dangerSoft: '#FDECEF',
  focus: '#0F6F70',
  disabled: '#D8E0DD',
  disabledText: '#687570',
  overlay: 'rgba(13, 27, 23, 0.55)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;
export const radii = { sm: 10, md: 14, lg: 22, pill: 999 } as const;
export const sizes = { touch: 48, screenMaxWidth: 720 } as const;

export const shadows = {
  card: {
    elevation: 2,
    shadowColor: '#17201E',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  } satisfies ViewStyle,
} as const;

export const typography = {
  display: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 39,
  } satisfies TextStyle,
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 31,
  } satisfies TextStyle,
  heading: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 26,
  } satisfies TextStyle,
  body: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 23,
  } satisfies TextStyle,
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
} as const;
