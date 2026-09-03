import { colors, severity, sizes, toastToneColors } from '@/ui/theme';

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
    expect(sizes.minTouch).toBeGreaterThanOrEqual(44);
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

  it('conserve un contraste AA pour chaque niveau de l’échelle de gravité', () => {
    for (const level of Object.values(severity)) {
      expect(contrast(level.text, level.background)).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it('conserve un contraste AA sur l’en-tête sombre', () => {
    expect(contrast(colors.onDark, colors.headerDark)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      contrast(colors.onDarkMuted, colors.headerDark),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(colors.headerDark, colors.accentOnDark),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('conserve un contraste AA pour chaque tonalité de toast sur son fond sombre', () => {
    // La tonalité d'un toast ne se lit qu'à son icône : si l'une d'elles passe
    // sous le seuil, l'information de gravité disparaît sans autre repli.
    for (const tone of Object.values(toastToneColors)) {
      expect(contrast(tone, colors.headerDark)).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrast(colors.accentOnDark, colors.headerDark),
    ).toBeGreaterThanOrEqual(4.5);
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
