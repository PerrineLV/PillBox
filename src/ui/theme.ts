import type { TextStyle, ViewStyle } from 'react-native';

export const colors = {
  brand: '#0F6F70',
  brandPressed: '#0A5657',
  brandSoft: '#E6F3EF',
  accent: '#D94F3D',
  accentSoft: '#FFF0ED',
  background: '#F4FAF7',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F5F3',
  text: '#17201E',
  textMuted: '#52605C',
  border: '#C5D0CC',
  borderStrong: '#879B95',
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
export const radii = { sm: 8, md: 12, lg: 18, pill: 999 } as const;
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
    fontSize: 32,
    fontWeight: '800',
    lineHeight: 39,
  } satisfies TextStyle,
  title: {
    color: colors.text,
    fontSize: 24,
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
