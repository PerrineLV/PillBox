import { colors, sizes } from '@/ui/theme';

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((value) => parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort(
    (left, right) => right - left,
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('design system PillBox', () => {
  it('garantit une cible tactile commune supérieure au minimum accessible', () => {
    expect(sizes.touch).toBeGreaterThanOrEqual(44);
  });

  it('conserve un contraste AA pour les textes et actions principales', () => {
    expect(contrast(colors.text, colors.background)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrast(colors.surface, colors.brand)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.danger, colors.dangerSoft)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it('conserve un contraste AA pour les bandeaux d’information colorés', () => {
    expect(contrast(colors.brand, colors.brandSoft)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrast(colors.warning, colors.warningSoft)).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});
