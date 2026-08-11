import {
  assertValidAsNeededTreatment,
  type AsNeededInfo,
  type TreatmentPhase,
} from '../treatment';

const NO_INFO: AsNeededInfo = {
  maxQuantityPerDayHalfUnits: null,
  minIntervalHours: null,
};

const PHASE: TreatmentPhase = {
  id: null,
  startDate: '2026-08-10',
  endDate: null,
  frequency: { type: 'daily' },
  dosage: [{ slot: 'morning', quantityHalfUnits: 2 }],
};

describe('traitement « si besoin »', () => {
  it('accepte un traitement sans phase, hors pilulier, sans information notée', () => {
    expect(() =>
      assertValidAsNeededTreatment({
        phases: [],
        includedInPillbox: false,
        asNeededInfo: NO_INFO,
      }),
    ).not.toThrow();
  });

  it('accepte une limite maximale et un intervalle minimal positifs', () => {
    expect(() =>
      assertValidAsNeededTreatment({
        phases: [],
        includedInPillbox: false,
        asNeededInfo: { maxQuantityPerDayHalfUnits: 8, minIntervalHours: 4 },
      }),
    ).not.toThrow();
  });

  it('refuse toute phase de posologie planifiée', () => {
    expect(() =>
      assertValidAsNeededTreatment({
        phases: [PHASE],
        includedInPillbox: false,
        asNeededInfo: NO_INFO,
      }),
    ).toThrow('posologie planifiée');
  });

  it('refuse l’inclusion dans le pilulier', () => {
    expect(() =>
      assertValidAsNeededTreatment({
        phases: [],
        includedInPillbox: true,
        asNeededInfo: NO_INFO,
      }),
    ).toThrow('inclus dans le pilulier');
  });

  it.each([0, -1, 1.5])('refuse une limite maximale invalide (%s)', (value) => {
    expect(() =>
      assertValidAsNeededTreatment({
        phases: [],
        includedInPillbox: false,
        asNeededInfo: {
          maxQuantityPerDayHalfUnits: value,
          minIntervalHours: null,
        },
      }),
    ).toThrow('limite maximale');
  });

  it.each([0, -1, 2.5])(
    'refuse un intervalle minimal invalide (%s)',
    (value) => {
      expect(() =>
        assertValidAsNeededTreatment({
          phases: [],
          includedInPillbox: false,
          asNeededInfo: {
            maxQuantityPerDayHalfUnits: null,
            minIntervalHours: value,
          },
        }),
      ).toThrow('intervalle minimal');
    },
  );
});
