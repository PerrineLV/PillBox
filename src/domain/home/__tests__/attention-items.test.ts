import {
  buildAttentionItems,
  isAttentionItemActionRequired,
  type AsNeededTreatmentInput,
  type AttentionItemsInput,
  type ExpirationAlertInput,
  type PrescriptionAttentionInput,
} from '../attention-items';
import type { PendingIntakeCount } from '@/domain/intakes/intake-tracking';
import type { KnownPreparation } from '@/domain/preparations/preparation';
import type { IntakeSlotTimes } from '@/domain/reminders/intake-reminder';
import type { RenewalItem } from '@/domain/renewal/renewal-list';
import type {
  PhaseFrequency,
  ScheduledTreatmentPhase,
  Treatment,
} from '@/domain/treatments/treatment';

function scheduledPhase(
  id: number,
  frequency: PhaseFrequency = { type: 'daily' },
): ScheduledTreatmentPhase {
  return {
    id,
    startDate: '2026-03-01',
    endDate: null,
    frequency,
    dosage: [{ slot: 'morning', quantityHalfUnits: 2 }],
  };
}

function treatment(id: number, overrides: Partial<Treatment> = {}): Treatment {
  return {
    id,
    specialtyCis: String(id),
    specialtyName: `Médicament ${id}`,
    pharmaceuticalForm: null,
    dosageKind: 'SCHEDULED',
    includedInPillbox: true,
    archivedAt: null,
    phases: [scheduledPhase(id * 10)],
    asNeededInfo: { maxQuantityPerDayHalfUnits: null, minIntervalHours: null },
    ...overrides,
  };
}

const SLOT_TIMES: IntakeSlotTimes = {
  morning: { hour: 8, minute: 0 },
  noon: { hour: 12, minute: 0 },
  evening: { hour: 19, minute: 0 },
  bedtime: { hour: 22, minute: 0 },
};

function renewalItem(overrides: Partial<RenewalItem> = {}): RenewalItem {
  return {
    specialtyCis: '1',
    specialtyName: 'Alpha',
    urgency: 'RUNS_OUT_SOON',
    availableHalfUnits: 4,
    nextPreparationHalfUnits: 14,
    missingHalfUnits: 0,
    ruptureDate: '2026-03-10',
    ruptureCause: 'CONSUMED',
    theoreticalRenewalDate: null,
    theoreticalRenewalWindow: null,
    runsOutBeforeRenewalWindow: false,
    usableBoxCount: null,
    ...overrides,
  };
}

function expiration(
  overrides: Partial<ExpirationAlertInput> = {},
): ExpirationAlertInput {
  return {
    boxId: 1,
    specialtyName: 'Beta',
    lot: 'LOT-1',
    expirationDate: '2026-03-15',
    remainingQuantity: 3,
    ...overrides,
  };
}

function prescription(
  overrides: Partial<PrescriptionAttentionInput> = {},
): PrescriptionAttentionInput {
  return {
    id: 1,
    label: 'Ordo généraliste',
    status: 'ACTIVE',
    validUntil: '2026-03-10',
    ...overrides,
  };
}

function pendingCount(
  date: string,
  slot: PendingIntakeCount['slot'],
  pending = 1,
): PendingIntakeCount {
  return { date, slot, pending };
}

function baseInput(
  overrides: Partial<AttentionItemsInput> = {},
): AttentionItemsInput {
  return {
    referenceDate: '2026-03-02',
    now: new Date(2026, 2, 2, 7),
    intakeRemindersEnabled: false,
    preparationReminder: { enabled: true, weekday: 'monday' },
    treatments: [],
    intakeSlotTimes: SLOT_TIMES,
    pendingIntakeCounts: [],
    draftPreparation: null,
    knownPreparationWeeks: [],
    renewalItems: [],
    expirations: [],
    asNeededTreatments: [],
    prescriptions: [],
    ...overrides,
  };
}

describe('buildAttentionItems', () => {
  it("n'affiche que la préparation quand rien d'autre ne demande d'attention", () => {
    const items = buildAttentionItems(baseInput());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'PREPARATION', mode: 'START' });
  });

  it('ordonne les catégories par priorité : prochaine prise, préparation, renouvellement, ordonnance, péremption, si besoin', () => {
    const asNeeded: AsNeededTreatmentInput = {
      treatmentId: 9,
      specialtyName: 'Gamma',
      maxQuantityPerDayHalfUnits: 6,
      minIntervalHours: null,
      lastIntake: null,
    };
    const items = buildAttentionItems(
      baseInput({
        intakeRemindersEnabled: true,
        treatments: [treatment(1)],
        pendingIntakeCounts: [pendingCount('2026-03-02', 'morning')],
        renewalItems: [renewalItem()],
        expirations: [expiration()],
        asNeededTreatments: [asNeeded],
        prescriptions: [prescription()],
      }),
    );
    expect(items.map((item) => item.type)).toEqual([
      'NEXT_INTAKE_GROUP',
      'PREPARATION',
      'STOCK_RENEWAL',
      'PRESCRIPTION_EXPIRY',
      'EXPIRATION',
      'AS_NEEDED_INFO',
    ]);
  });

  describe('prochaine prise', () => {
    it("n'affiche rien lorsque les rappels sont désactivés, même avec un traitement planifié", () => {
      const items = buildAttentionItems(
        baseInput({
          intakeRemindersEnabled: false,
          treatments: [treatment(1)],
        }),
      );
      expect(items.some((item) => item.type === 'NEXT_INTAKE_GROUP')).toBe(
        false,
      );
    });

    it("choisit le groupe le plus proche dans la fenêtre d'une semaine", () => {
      const items = buildAttentionItems(
        baseInput({
          intakeRemindersEnabled: true,
          now: new Date(2026, 2, 2, 7),
          treatments: [treatment(1)],
          pendingIntakeCounts: [pendingCount('2026-03-02', 'morning')],
        }),
      );
      const next = items.find((item) => item.type === 'NEXT_INTAKE_GROUP');
      expect(next).toMatchObject({
        medicationCount: 1,
        groups: [{ date: '2026-03-02', slot: 'morning' }],
      });
    });

    it("n'affiche rien au-delà de la fenêtre de recherche", () => {
      const farFuture = treatment(1, {
        phases: [
          scheduledPhase(10, {
            type: 'interval',
            everyNDays: 30,
            anchorDate: '2026-03-02',
          }),
        ],
      });
      const items = buildAttentionItems(
        baseInput({
          intakeRemindersEnabled: true,
          now: new Date(2026, 2, 3, 0),
          treatments: [farFuture],
          pendingIntakeCounts: [pendingCount('2026-04-01', 'morning')],
        }),
      );
      expect(items.some((item) => item.type === 'NEXT_INTAKE_GROUP')).toBe(
        false,
      );
    });

    it('passe au prochain créneau encore en attente quand le plus proche est déjà entièrement confirmé', () => {
      const items = buildAttentionItems(
        baseInput({
          intakeRemindersEnabled: true,
          now: new Date(2026, 2, 2, 7),
          treatments: [treatment(1)],
          // Le créneau du 2 mars est entièrement pris ou ignoré (aucune
          // entrée « en attente » n'existe pour lui) : la carte doit alors
          // pointer vers le prochain jour qui compte encore une prise.
          pendingIntakeCounts: [pendingCount('2026-03-03', 'morning')],
        }),
      );
      const next = items.find((item) => item.type === 'NEXT_INTAKE_GROUP');
      expect(next).toMatchObject({
        groups: [{ date: '2026-03-03', slot: 'morning' }],
      });
    });

    it("garde le créneau du jour tant qu'il reste en attente, même si son heure est déjà passée", () => {
      const items = buildAttentionItems(
        baseInput({
          intakeRemindersEnabled: true,
          // 9h20 : après le créneau du matin (8h00), qui n'a pas été validé.
          now: new Date(2026, 2, 2, 9, 20),
          treatments: [treatment(1)],
          pendingIntakeCounts: [pendingCount('2026-03-02', 'morning')],
        }),
      );
      const next = items.find((item) => item.type === 'NEXT_INTAKE_GROUP');
      expect(next).toMatchObject({
        groups: [{ date: '2026-03-02', slot: 'morning' }],
      });
    });

    it("n'affiche rien lorsque tout est déjà confirmé sur la fenêtre de recherche", () => {
      const items = buildAttentionItems(
        baseInput({
          intakeRemindersEnabled: true,
          now: new Date(2026, 2, 2, 7),
          treatments: [treatment(1)],
          pendingIntakeCounts: [],
        }),
      );
      expect(items.some((item) => item.type === 'NEXT_INTAKE_GROUP')).toBe(
        false,
      );
    });

    it('affiche le nombre de médicaments encore en attente, pas le nombre total planifié', () => {
      const items = buildAttentionItems(
        baseInput({
          intakeRemindersEnabled: true,
          now: new Date(2026, 2, 2, 7),
          treatments: [treatment(1), treatment(2)],
          // Sur les deux traitements prévus à 8h, un seul reste en attente :
          // l'autre a déjà été marqué pris ou ignoré.
          pendingIntakeCounts: [pendingCount('2026-03-02', 'morning', 1)],
        }),
      );
      const next = items.find((item) => item.type === 'NEXT_INTAKE_GROUP');
      expect(next).toMatchObject({ medicationCount: 1 });
    });
  });

  describe('préparation', () => {
    it('propose de commencer quand aucune préparation ne couvre la semaine à venir', () => {
      const [item] = buildAttentionItems(baseInput());
      expect(item).toMatchObject({ type: 'PREPARATION', mode: 'START' });
    });

    it('propose de reprendre quand une préparation est en cours (couvre aussi les préparations incomplètes)', () => {
      const [item] = buildAttentionItems(
        baseInput({
          draftPreparation: {
            startDate: '2026-03-03',
            endDate: '2026-03-09',
            completedCount: 2,
            totalCount: 5,
          },
        }),
      );
      expect(item).toMatchObject({
        type: 'PREPARATION',
        mode: 'RESUME',
        completedCount: 2,
        totalCount: 5,
      });
    });

    it('ne propose rien lorsque la semaine à venir est déjà validée', () => {
      const known: KnownPreparation[] = [
        { id: 1, startDate: '2026-03-03', status: 'COMPLETED' },
      ];
      const items = buildAttentionItems(
        baseInput({ knownPreparationWeeks: known }),
      );
      expect(items.some((item) => item.type === 'PREPARATION')).toBe(false);
    });

    it('propose de commencer uniquement le jour configuré pour le rappel', () => {
      const built = buildAttentionItems(
        baseInput({
          preparationReminder: { enabled: true, weekday: 'monday' },
        }),
      );
      expect(built).toContainEqual(
        expect.objectContaining({ type: 'PREPARATION', mode: 'START' }),
      );
    });

    it('ne propose pas de commencer la veille ou le lendemain du jour configuré', () => {
      const before = buildAttentionItems(
        baseInput({
          referenceDate: '2026-03-01',
          preparationReminder: { enabled: true, weekday: 'monday' },
        }),
      );
      const after = buildAttentionItems(
        baseInput({
          referenceDate: '2026-03-03',
          preparationReminder: { enabled: true, weekday: 'monday' },
        }),
      );
      expect(before.some((item) => item.type === 'PREPARATION')).toBe(false);
      expect(after.some((item) => item.type === 'PREPARATION')).toBe(false);
    });

    it('ne propose pas de commencer lorsque le rappel de préparation est désactivé', () => {
      const built = buildAttentionItems(
        baseInput({
          preparationReminder: { enabled: false, weekday: 'monday' },
        }),
      );
      expect(built.some((item) => item.type === 'PREPARATION')).toBe(false);
    });

    it('laisse toujours reprendre une préparation déjà en cours', () => {
      const built = buildAttentionItems(
        baseInput({
          preparationReminder: { enabled: false, weekday: 'monday' },
          draftPreparation: {
            startDate: '2026-03-03',
            endDate: '2026-03-09',
            completedCount: 1,
            totalCount: 2,
          },
        }),
      );
      expect(built).toContainEqual(
        expect.objectContaining({ type: 'PREPARATION', mode: 'RESUME' }),
      );
    });
  });

  describe('renouvellement et péremption', () => {
    it('reprend la liste de renouvellement telle que classée par le moteur de prévision, sans recalcul', () => {
      const items = [
        renewalItem({ specialtyCis: 'A' }),
        renewalItem({ specialtyCis: 'B', urgency: 'LOW_STOCK' }),
      ];
      const built = buildAttentionItems(baseInput({ renewalItems: items }));
      const renewals = built.filter((item) => item.type === 'STOCK_RENEWAL');
      expect(renewals.map((item) => item.item.specialtyCis)).toEqual([
        'A',
        'B',
      ]);
    });

    it('reprend les péremptions telles que fournies, sans recalcul', () => {
      const items = [expiration({ boxId: 1 }), expiration({ boxId: 2 })];
      const built = buildAttentionItems(baseInput({ expirations: items }));
      const result = built.filter((item) => item.type === 'EXPIRATION');
      expect(result.map((item) => item.boxId)).toEqual([1, 2]);
    });
  });

  describe('ordonnance', () => {
    it('signale une ordonnance active dont la fin de validité approche', () => {
      const built = buildAttentionItems(
        baseInput({ prescriptions: [prescription()] }),
      );
      const items = built.filter((item) => item.type === 'PRESCRIPTION_EXPIRY');
      expect(items).toMatchObject([
        {
          prescriptionId: 1,
          label: 'Ordo généraliste',
          validUntil: '2026-03-10',
        },
      ]);
    });

    it("n'affiche rien tant que la fin de validité est lointaine", () => {
      const built = buildAttentionItems(
        baseInput({
          prescriptions: [prescription({ validUntil: '2026-12-01' })],
        }),
      );
      expect(built.some((item) => item.type === 'PRESCRIPTION_EXPIRY')).toBe(
        false,
      );
    });

    it('ignore une ordonnance EXPIRED ou REPLACED, ou sans fin de validité connue', () => {
      const built = buildAttentionItems(
        baseInput({
          prescriptions: [
            prescription({ id: 1, status: 'EXPIRED' }),
            prescription({ id: 2, status: 'REPLACED' }),
            prescription({ id: 3, validUntil: null }),
          ],
        }),
      );
      expect(built.some((item) => item.type === 'PRESCRIPTION_EXPIRY')).toBe(
        false,
      );
    });

    it('distingue cette alerte du renouvellement en pharmacie (ticket 47)', () => {
      const built = buildAttentionItems(
        baseInput({
          renewalItems: [renewalItem()],
          prescriptions: [prescription()],
        }),
      );
      expect(built.map((item) => item.type)).toEqual(
        expect.arrayContaining(['STOCK_RENEWAL', 'PRESCRIPTION_EXPIRY']),
      );
    });
  });

  describe('traitements si besoin', () => {
    it("n'affiche que les traitements avec une limite ou un intervalle renseigné", () => {
      const withLimit: AsNeededTreatmentInput = {
        treatmentId: 1,
        specialtyName: 'Avec limite',
        maxQuantityPerDayHalfUnits: 6,
        minIntervalHours: null,
        lastIntake: null,
      };
      const withInterval: AsNeededTreatmentInput = {
        treatmentId: 2,
        specialtyName: 'Avec intervalle',
        maxQuantityPerDayHalfUnits: null,
        minIntervalHours: 4,
        lastIntake: null,
      };
      const withoutInfo: AsNeededTreatmentInput = {
        treatmentId: 3,
        specialtyName: 'Sans info',
        maxQuantityPerDayHalfUnits: null,
        minIntervalHours: null,
        lastIntake: null,
      };
      const built = buildAttentionItems(
        baseInput({
          asNeededTreatments: [withoutInfo, withInterval, withLimit],
        }),
      );
      const asNeeded = built.filter((item) => item.type === 'AS_NEEDED_INFO');
      // Triés par nom : « Avec intervalle » précède « Avec limite ».
      expect(asNeeded.map((item) => item.treatmentId)).toEqual([2, 1]);
    });
  });
});

describe('isAttentionItemActionRequired', () => {
  it('ne requiert aucune action pour une préparation prête ou une information si besoin', () => {
    expect(
      isAttentionItemActionRequired({
        type: 'PREPARATION',
        id: 'p',
        mode: 'READY',
        startDate: '2026-03-03',
        endDate: '2026-03-09',
        completedCount: 0,
        totalCount: 0,
      }),
    ).toBe(false);
    expect(
      isAttentionItemActionRequired({
        type: 'AS_NEEDED_INFO',
        id: 'a',
        treatmentId: 1,
        specialtyName: 'Alpha',
        lastIntake: null,
      }),
    ).toBe(false);
    expect(
      isAttentionItemActionRequired({
        type: 'NEXT_INTAKE_GROUP',
        id: 'n',
        scheduledAt: '2026-03-02T08:00:00.000Z',
        groups: [{ date: '2026-03-02', slot: 'morning' }],
        medicationCount: 1,
      }),
    ).toBe(false);
  });

  it('requiert une action pour une préparation à démarrer ou reprendre, un renouvellement ou une péremption', () => {
    expect(
      isAttentionItemActionRequired({
        type: 'PREPARATION',
        id: 'p',
        mode: 'START',
        startDate: '2026-03-03',
        endDate: '2026-03-09',
        completedCount: 0,
        totalCount: 0,
      }),
    ).toBe(true);
    expect(
      isAttentionItemActionRequired({
        type: 'STOCK_RENEWAL',
        id: 's',
        item: renewalItem(),
      }),
    ).toBe(true);
    expect(
      isAttentionItemActionRequired({
        type: 'EXPIRATION',
        id: 'e',
        ...expiration(),
      }),
    ).toBe(true);
    expect(
      isAttentionItemActionRequired({
        type: 'PRESCRIPTION_EXPIRY',
        id: 'pe',
        prescriptionId: 1,
        label: 'Ordo',
        validUntil: '2026-03-10',
      }),
    ).toBe(true);
  });
});
