import { mentionsControlledDispensing } from '../controlled-dispensing-detection';

describe('mentionsControlledDispensing', () => {
  it('détecte une mention de stupéfiants, accents et casse compris', () => {
    expect(mentionsControlledDispensing('Stupéfiants')).toBe(true);
    expect(mentionsControlledDispensing('stupefiants')).toBe(true);
  });

  it('détecte une mention de délivrance fractionnée', () => {
    expect(
      mentionsControlledDispensing('délivrance fractionnée de 7 jours'),
    ).toBe(true);
  });

  it('ignore une condition de prescription sans rapport', () => {
    expect(mentionsControlledDispensing('liste I')).toBe(false);
    expect(mentionsControlledDispensing('prescription hospitalière')).toBe(
      false,
    );
  });
});
