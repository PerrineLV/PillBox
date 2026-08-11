import {
  assertValidAsNeededIntakeDraft,
  type AsNeededIntakeDraft,
} from '../as-needed-intake';

const DRAFT: AsNeededIntakeDraft = {
  treatmentId: 1,
  takenAt: '2026-08-11T14:30:00.000Z',
  quantityHalfUnits: 2,
  note: null,
};

describe('prise ponctuelle « si besoin »', () => {
  it('accepte une prise valide, avec ou sans note', () => {
    expect(() => assertValidAsNeededIntakeDraft(DRAFT)).not.toThrow();
    expect(() =>
      assertValidAsNeededIntakeDraft({ ...DRAFT, note: 'Douleur au réveil' }),
    ).not.toThrow();
  });

  it('refuse un traitement invalide', () => {
    expect(() =>
      assertValidAsNeededIntakeDraft({ ...DRAFT, treatmentId: 0 }),
    ).toThrow('Traitement invalide');
  });

  it('refuse une date et heure de prise invalide', () => {
    expect(() =>
      assertValidAsNeededIntakeDraft({ ...DRAFT, takenAt: 'pas une date' }),
    ).toThrow('invalides');
  });

  it.each([0, -1, 1.5])(
    'refuse une quantité invalide (%s)',
    (quantityHalfUnits) => {
      expect(() =>
        assertValidAsNeededIntakeDraft({ ...DRAFT, quantityHalfUnits }),
      ).toThrow('quantité');
    },
  );
});
