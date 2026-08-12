import type { MedicationBox } from '@/domain/inventory/inventory';
import type { Treatment } from '@/domain/treatments/treatment';

import {
  assertVerificationEvidence,
  buildAcceptedCisIndex,
  effectiveUsableBoxes,
  evaluateBoxAvailability,
  generatePreparationSnapshot,
  listBoxesForMedication,
  matchScannedBox,
  preparationEndDate,
  preparationStartDate,
  preparationWeeks,
  preparationWeekState,
  remainingHalfUnitsFor,
  verifyPreparationBox,
} from '../preparation';

function treatment(overrides: Partial<Treatment> = {}): Treatment {
  return {
    id: 1,
    specialtyCis: '60000001',
    specialtyName: 'Alpha',
    pharmaceuticalForm: 'comprimé',
    dosageKind: 'SCHEDULED',
    includedInPillbox: true,
    archivedAt: null,
    phases: [
      {
        id: 1,
        startDate: '2026-08-01',
        endDate: null,
        frequency: { type: 'daily' },
        dosage: [{ slot: 'morning', quantityHalfUnits: 2 }],
      },
    ],
    asNeededInfo: { maxQuantityPerDayHalfUnits: null, minIntervalHours: null },
    controlledDispensing: null,
    ...overrides,
  };
}

function box(overrides: Partial<MedicationBox> = {}): MedicationBox {
  return {
    id: 1,
    specialtyCis: '60000001',
    specialtyName: 'Alpha',
    pharmaceuticalForm: 'comprimé',
    presentationCip13: '3400000000000',
    presentationLabel: 'Boîte',
    lot: 'LOT',
    expirationDate: '2027-01-01',
    initialQuantity: 30,
    remainingQuantity: 10,
    origin: 'SCAN',
    scanRaw: 'raw',
    ...overrides,
  };
}

describe('génération d’une préparation de sept jours', () => {
  it('commence le lendemain lorsque la préparation est lancée un dimanche', () => {
    expect(preparationStartDate('2026-08-09')).toBe('2026-08-10');
  });

  it('commence aussi le lendemain pour les autres jours', () => {
    expect(preparationStartDate('2026-08-08')).toBe('2026-08-09');
    expect(preparationStartDate('2026-08-10')).toBe('2026-08-11');
  });

  it('fige chaque date, créneau, identité et quantité pendant exactement 7 jours', () => {
    const source = treatment();
    const snapshot = generatePreparationSnapshot(
      [source],
      [box()],
      '2026-08-03',
      '2026-08-03',
    );
    expect(snapshot.endDate).toBe('2026-08-09');
    expect(snapshot.items).toHaveLength(7);
    expect(snapshot.items[0]).toEqual({
      treatmentId: 1,
      specialtyCis: '60000001',
      specialtyName: 'Alpha',
      pharmaceuticalForm: 'comprimé',
      date: '2026-08-03',
      slot: 'morning',
      quantityHalfUnits: 2,
    });
    source.specialtyName = 'Nom modifié';
    source.phases = [];
    expect(snapshot.items[0].specialtyName).toBe('Alpha');
    expect(snapshot.items).toHaveLength(7);
    expect(Object.isFrozen(snapshot.items)).toBe(true);
  });

  it('additionne exactement les fractions et plusieurs prises quotidiennes', () => {
    const multi = treatment({
      phases: [
        {
          id: 1,
          startDate: '2026-08-01',
          endDate: null,
          frequency: { type: 'daily' },
          dosage: [
            { slot: 'morning', quantityHalfUnits: 1 },
            { slot: 'noon', quantityHalfUnits: 3 },
            { slot: 'bedtime', quantityHalfUnits: 1 },
          ],
        },
      ],
    });
    const snapshot = generatePreparationSnapshot(
      [multi],
      [box({ remainingQuantity: 17 })],
      '2026-08-03',
      '2026-08-03',
    );
    expect(snapshot.items).toHaveLength(21);
    expect(snapshot.requirements[0]).toEqual({
      specialtyCis: '60000001',
      specialtyName: 'Alpha',
      requiredHalfUnits: 35,
      usableStockHalfUnits: 34,
      missingHalfUnits: 1,
    });
    expect(snapshot.hasShortages).toBe(true);
  });

  it('regroupe plusieurs traitements de la même spécialité', () => {
    const snapshot = generatePreparationSnapshot(
      [treatment(), treatment({ id: 2 })],
      [box()],
      '2026-08-03',
      '2026-08-03',
    );
    expect(snapshot.requirements).toHaveLength(1);
    expect(snapshot.requirements[0].requiredHalfUnits).toBe(28);
  });

  it('exclut du stock utilisable les boîtes périmées sans suggérer de solution', () => {
    const snapshot = generatePreparationSnapshot(
      [treatment()],
      [box({ expirationDate: '2026-08-02', remainingQuantity: 30 })],
      '2026-08-03',
      '2026-08-03',
    );
    expect(snapshot.requirements[0]).toMatchObject({
      requiredHalfUnits: 14,
      usableStockHalfUnits: 0,
      missingHalfUnits: 14,
    });
  });

  it('ignore les traitements archivés ou exclus du pilulier', () => {
    const snapshot = generatePreparationSnapshot(
      [
        treatment({ archivedAt: '2026-08-01' }),
        treatment({ id: 2, includedInPillbox: false }),
      ],
      [],
      '2026-08-03',
      '2026-08-03',
    );
    expect(snapshot.items).toEqual([]);
    expect(snapshot.requirements).toEqual([]);
    expect(snapshot.hasShortages).toBe(false);
  });
});

describe('comptage du stock équivalent générique confirmé (ticket 24b)', () => {
  it('ne change rien pour un traitement sans équivalence mémorisée', () => {
    const snapshot = generatePreparationSnapshot(
      [treatment()],
      [box({ remainingQuantity: 6 })],
      '2026-08-03',
      '2026-08-03',
      [],
    );
    expect(snapshot.requirements[0]).toMatchObject({
      requiredHalfUnits: 14,
      usableStockHalfUnits: 12,
      missingHalfUnits: 2,
    });
  });

  it("compte une boîte d'un CIS confirmé comme équivalence pour ce traitement, même si le stock est entièrement dans ce CIS équivalent", () => {
    const snapshot = generatePreparationSnapshot(
      [treatment()],
      [box({ specialtyCis: '60000002', remainingQuantity: 10 })],
      '2026-08-03',
      '2026-08-03',
      [{ treatmentId: 1, cis: '60000002' }],
    );
    expect(snapshot.requirements[0]).toMatchObject({
      specialtyCis: '60000001',
      requiredHalfUnits: 14,
      usableStockHalfUnits: 20,
      missingHalfUnits: 0,
    });
    expect(snapshot.hasShortages).toBe(false);
  });

  it('additionne les boîtes de CIS exact et de CIS équivalent confirmé', () => {
    const snapshot = generatePreparationSnapshot(
      [treatment()],
      [
        box({ remainingQuantity: 3 }),
        box({ id: 2, specialtyCis: '60000002', remainingQuantity: 4 }),
      ],
      '2026-08-03',
      '2026-08-03',
      [{ treatmentId: 1, cis: '60000002' }],
    );
    expect(snapshot.requirements[0]).toMatchObject({
      requiredHalfUnits: 14,
      usableStockHalfUnits: 14,
      missingHalfUnits: 0,
    });
  });

  it('exclut toujours un CIS du même groupe générique mais jamais confirmé pour ce traitement précis', () => {
    const snapshot = generatePreparationSnapshot(
      [treatment()],
      [box({ specialtyCis: '60000002', remainingQuantity: 10 })],
      '2026-08-03',
      '2026-08-03',
      [{ treatmentId: 42, cis: '60000002' }],
    );
    expect(snapshot.requirements[0]).toMatchObject({
      usableStockHalfUnits: 0,
      missingHalfUnits: 14,
    });
  });

  it('ne modifie jamais le CIS du traitement ni celui enregistré sur la boîte', () => {
    const source = treatment();
    const equivalentBox = box({
      specialtyCis: '60000002',
      remainingQuantity: 10,
    });
    generatePreparationSnapshot(
      [source],
      [equivalentBox],
      '2026-08-03',
      '2026-08-03',
      [{ treatmentId: 1, cis: '60000002' }],
    );
    expect(source.specialtyCis).toBe('60000001');
    expect(equivalentBox.specialtyCis).toBe('60000002');
  });
});

describe('index des CIS acceptés par équivalence mémorisée', () => {
  it('regroupe les équivalences de tous les traitements partageant un même CIS', () => {
    const index = buildAcceptedCisIndex(
      [treatment(), treatment({ id: 2 })],
      [{ treatmentId: 2, cis: '60000002' }],
    );
    expect(index.get('60000001')).toEqual(new Set(['60000001', '60000002']));
  });

  it('ne propage jamais une équivalence à un traitement pour lequel elle n’a pas été confirmée', () => {
    const index = buildAcceptedCisIndex(
      [treatment({ id: 1, specialtyCis: '60000001' })],
      [{ treatmentId: 99, cis: '60000002' }],
    );
    expect(index.get('60000001')).toEqual(new Set(['60000001']));
  });
});

describe('choix de la semaine à préparer', () => {
  it('propose la semaine à venir puis la suivante, sans chevauchement', () => {
    expect(preparationWeeks('2026-08-09')).toEqual([
      { choice: 'CURRENT', startDate: '2026-08-10', endDate: '2026-08-16' },
      { choice: 'NEXT', startDate: '2026-08-17', endDate: '2026-08-23' },
    ]);
  });

  it('traverse les mois sans décaler la durée de sept jours', () => {
    expect(preparationWeeks('2026-08-29')).toEqual([
      { choice: 'CURRENT', startDate: '2026-08-30', endDate: '2026-09-05' },
      { choice: 'NEXT', startDate: '2026-09-06', endDate: '2026-09-12' },
    ]);
    expect(preparationEndDate('2026-12-28')).toBe('2027-01-03');
  });

  it('bloque une semaine déjà validée et signale une préparation à reprendre', () => {
    const known = [
      { id: 1, startDate: '2026-08-10', status: 'COMPLETED' as const },
      { id: 2, startDate: '2026-08-17', status: 'DRAFT' as const },
    ];
    expect(preparationWeekState('2026-08-10', known)).toBe('ALREADY_PREPARED');
    expect(preparationWeekState('2026-08-17', known)).toBe('IN_PROGRESS');
    expect(preparationWeekState('2026-08-24', known)).toBe('AVAILABLE');
    expect(preparationWeekState('2026-08-10', [])).toBe('AVAILABLE');
  });

  it('considère une semaine validée comme préparée même après une nouvelle tentative', () => {
    expect(
      preparationWeekState('2026-08-10', [
        { id: 2, startDate: '2026-08-10', status: 'DRAFT' },
        { id: 1, startDate: '2026-08-10', status: 'COMPLETED' },
      ]),
    ).toBe('ALREADY_PREPARED');
  });
});

describe('vérification des boîtes pendant la préparation', () => {
  it('bloque un produit différent et une boîte périmée', () => {
    expect(
      verifyPreparationBox(
        '60000001',
        14,
        box({ specialtyCis: 'OTHER' }),
        [box()],
        '2026-08-03',
      ).status,
    ).toBe('WRONG_MEDICATION');
    expect(
      verifyPreparationBox(
        '60000001',
        14,
        box({ expirationDate: '2026-08-02' }),
        [box()],
        '2026-08-03',
      ).status,
    ).toBe('EXPIRED');
  });

  it('bloque une boîte vide, qui ne peut rien apporter', () => {
    expect(
      verifyPreparationBox(
        '60000001',
        14,
        box({ remainingQuantity: 0 }),
        [box({ remainingQuantity: 0 })],
        '2026-08-03',
      ).status,
    ).toBe('INSUFFICIENT');
  });

  it('accepte une boîte insuffisante seule comme contribution partielle', () => {
    const result = verifyPreparationBox(
      '60000001',
      22,
      box({ remainingQuantity: 10 }),
      [box({ remainingQuantity: 10 })],
      '2026-08-03',
    );
    expect(result).toMatchObject({
      status: 'PARTIAL',
      quantityHalfUnits: 20,
      remainingAfterHalfUnits: 2,
    });
  });

  it('couvre exactement le reste à charge, pas toute la boîte', () => {
    const result = verifyPreparationBox(
      '60000001',
      10,
      box({ remainingQuantity: 20 }),
      [box({ remainingQuantity: 20 })],
      '2026-08-03',
    );
    expect(result).toMatchObject({ status: 'VALID', quantityHalfUnits: 10 });
  });

  it('recommande FEFO mais accepte explicitement un autre lot valide', () => {
    const earliest = box({
      id: 1,
      lot: 'PREMIER',
      expirationDate: '2026-09-01',
    });
    const later = box({ id: 2, lot: 'SUIVANT', expirationDate: '2027-01-01' });
    expect(
      verifyPreparationBox(
        '60000001',
        14,
        earliest,
        [later, earliest],
        '2026-08-03',
      ),
    ).toMatchObject({ status: 'VALID', isFefo: true });
    expect(
      verifyPreparationBox(
        '60000001',
        14,
        later,
        [later, earliest],
        '2026-08-03',
      ),
    ).toMatchObject({
      status: 'VALID',
      isFefo: false,
      recommendedBox: earliest,
    });
  });

  it('relie le scan à une seule boîte avec présentation, lot et péremption exacts', () => {
    const stored = box();
    expect(
      matchScannedBox(
        {
          presentationCip13: stored.presentationCip13,
          lot: 'LOT',
          expirationDate: '2027-01-01',
        },
        [stored],
      ),
    ).toEqual({ status: 'MATCHED', box: stored });
    expect(
      matchScannedBox(
        {
          presentationCip13: stored.presentationCip13,
          lot: 'AUTRE',
          expirationDate: '2027-01-01',
        },
        [stored],
      ),
    ).toEqual({ status: 'UNKNOWN' });
  });

  it('résout automatiquement plusieurs boîtes identiques en retenant celle avec le moins de stock restant', () => {
    const identity = {
      presentationCip13: '3400000000000',
      lot: 'LOT',
      expirationDate: '2027-01-01',
    };
    const fuller = box({ id: 1, remainingQuantity: 10 });
    const emptier = box({ id: 2, remainingQuantity: 4 });
    expect(matchScannedBox(identity, [fuller, emptier])).toEqual({
      status: 'MATCHED',
      box: emptier,
    });
    expect(matchScannedBox(identity, [emptier, fuller])).toEqual({
      status: 'MATCHED',
      box: emptier,
    });
  });

  it('départage deux boîtes identiques à quantité restante égale par l’id le plus petit', () => {
    const identity = {
      presentationCip13: '3400000000000',
      lot: 'LOT',
      expirationDate: '2027-01-01',
    };
    const lower = box({ id: 1, remainingQuantity: 10 });
    const higher = box({ id: 2, remainingQuantity: 10 });
    expect(matchScannedBox(identity, [higher, lower])).toEqual({
      status: 'MATCHED',
      box: lower,
    });
    expect(matchScannedBox(identity, [lower, higher])).toEqual({
      status: 'MATCHED',
      box: lower,
    });
  });

  it('écarte une boîte déjà vidée au profit d’une boîte identique encore disponible', () => {
    const identity = {
      presentationCip13: '3400000000000',
      lot: 'LOT',
      expirationDate: '2027-01-01',
    };
    const exhausted = box({ id: 1, remainingQuantity: 0 });
    const remaining = box({ id: 2, remainingQuantity: 4 });
    expect(matchScannedBox(identity, [exhausted, remaining])).toEqual({
      status: 'MATCHED',
      box: remaining,
    });
    expect(matchScannedBox(identity, [remaining, exhausted])).toEqual({
      status: 'MATCHED',
      box: remaining,
    });
  });

  it('rescanner la même étiquette bascule sur la seconde boîte une fois la première épuisée par cette préparation', () => {
    const identity = {
      presentationCip13: '3400000000000',
      lot: 'LOT',
      expirationDate: '2027-01-01',
    };
    const smaller = box({ id: 1, remainingQuantity: 4 });
    const larger = box({ id: 2, remainingQuantity: 10 });
    const firstScan = matchScannedBox(identity, [smaller, larger]);
    expect(firstScan).toEqual({ status: 'MATCHED', box: smaller });
    // La première contribution consomme entièrement la boîte la plus petite.
    const afterFirstContribution = effectiveUsableBoxes(
      [smaller, larger],
      [{ boxId: smaller.id, quantityHalfUnits: smaller.remainingQuantity * 2 }],
    );
    const secondScan = matchScannedBox(identity, afterFirstContribution);
    expect(secondScan).toMatchObject({ status: 'MATCHED' });
    if (secondScan.status === 'MATCHED') {
      expect(secondScan.box.id).toBe(larger.id);
    }
  });

  it('vérifie une boîte ajoutée manuellement comme une boîte scannée', () => {
    const manual = box({ origin: 'MANUAL', scanRaw: null });
    expect(
      verifyPreparationBox('60000001', 14, manual, [manual], '2026-08-03'),
    ).toMatchObject({ status: 'VALID', isFefo: true });
    expect(
      verifyPreparationBox(
        '60000001',
        14,
        { ...manual, expirationDate: '2026-08-02' },
        [manual],
        '2026-08-03',
      ).status,
    ).toBe('EXPIRED');
  });

  it('propose les boîtes du stock du lot FEFO vers les boîtes périmées', () => {
    const expired = box({ id: 1, expirationDate: '2026-08-01' });
    const later = box({ id: 2, expirationDate: '2027-01-01' });
    const soonest = box({ id: 3, expirationDate: '2026-09-01' });
    const other = box({ id: 4, specialtyCis: 'AUTRE' });
    expect(
      listBoxesForMedication(
        '60000001',
        14,
        [expired, later, soonest, other],
        '2026-08-03',
      ).map((item) => item.id),
    ).toEqual([3, 2, 1]);
  });

  it('priorise aussi selon la quantité : suffisante avant insuffisante avant périmée', () => {
    const insufficientButEarliest = box({
      id: 1,
      remainingQuantity: 2,
      expirationDate: '2026-08-15',
    });
    const sufficientButLater = box({
      id: 2,
      remainingQuantity: 20,
      expirationDate: '2027-01-01',
    });
    const expired = box({
      id: 3,
      remainingQuantity: 20,
      expirationDate: '2026-08-01',
    });
    expect(
      listBoxesForMedication(
        '60000001',
        14,
        [insufficientButEarliest, sufficientButLater, expired],
        '2026-08-03',
      ).map((item) => item.id),
    ).toEqual([2, 1, 3]);
  });

  it('évalue la disponibilité d’une boîte selon péremption et quantité', () => {
    expect(
      evaluateBoxAvailability(
        box({ expirationDate: '2026-08-01' }),
        14,
        '2026-08-03',
      ),
    ).toBe('EXPIRED');
    expect(
      evaluateBoxAvailability(box({ remainingQuantity: 2 }), 14, '2026-08-03'),
    ).toBe('INSUFFICIENT');
    expect(
      evaluateBoxAvailability(box({ remainingQuantity: 10 }), 14, '2026-08-03'),
    ).toBe('SUFFICIENT');
  });

  it('refuse un CIS différent hors groupe générique même avec un acceptedGenericCis renseigné pour un autre CIS', () => {
    expect(
      verifyPreparationBox(
        '60000001',
        14,
        box({ specialtyCis: 'AUTRE' }),
        [box()],
        '2026-08-03',
        'GENERIQUE_ATTENDU',
      ).status,
    ).toBe('WRONG_MEDICATION');
  });

  it('accepte un CIS différent explicitement reconnu comme équivalent générique', () => {
    const generic = box({ specialtyCis: 'GENERIQUE', remainingQuantity: 20 });
    const result = verifyPreparationBox(
      '60000001',
      14,
      generic,
      [generic],
      '2026-08-03',
      'GENERIQUE',
    );
    expect(result).toMatchObject({ status: 'VALID', quantityHalfUnits: 14 });
  });

  it('recommande le lot FEFO parmi les boîtes du même CIS que celle acceptée, sans les mélanger à celles du CIS attendu', () => {
    const expectedSoonest = box({
      id: 1,
      specialtyCis: '60000001',
      expirationDate: '2026-08-10',
    });
    const genericLater = box({
      id: 2,
      specialtyCis: 'GENERIQUE',
      expirationDate: '2027-01-01',
      remainingQuantity: 20,
    });
    const result = verifyPreparationBox(
      '60000001',
      14,
      genericLater,
      [expectedSoonest, genericLater],
      '2026-08-03',
      'GENERIQUE',
    );
    expect(result).toMatchObject({
      status: 'VALID',
      isFefo: true,
      recommendedBox: genericLater,
    });
  });

  it('élargit la liste des boîtes du stock aux CIS génériques déjà reconnus', () => {
    const expected = box({ id: 1, specialtyCis: '60000001' });
    const genericMember = box({ id: 2, specialtyCis: 'GENERIQUE' });
    const unrelated = box({ id: 3, specialtyCis: 'SANS_RAPPORT' });
    expect(
      listBoxesForMedication(
        '60000001',
        14,
        [expected, genericMember, unrelated],
        '2026-08-03',
        ['GENERIQUE'],
      ).map((item) => item.id),
    ).toEqual(expect.arrayContaining([1, 2]));
    expect(
      listBoxesForMedication(
        '60000001',
        14,
        [expected, genericMember, unrelated],
        '2026-08-03',
        ['GENERIQUE'],
      ).map((item) => item.id),
    ).not.toContain(3);
  });

  it('refuse de présenter une sélection manuelle comme une vérification par scan', () => {
    expect(() => assertVerificationEvidence('SCAN', 'raw')).not.toThrow();
    expect(() => assertVerificationEvidence('MANUAL', null)).not.toThrow();
    expect(() => assertVerificationEvidence('SCAN', null)).toThrow('brute');
    expect(() => assertVerificationEvidence('SCAN', '')).toThrow('brute');
    expect(() => assertVerificationEvidence('MANUAL', 'raw')).toThrow('scan');
  });
});

describe('répartition d’un médicament entre plusieurs boîtes', () => {
  it('réduit le reste à couvrir au fil des contributions déjà retenues', () => {
    expect(remainingHalfUnitsFor(14, [])).toBe(14);
    expect(
      remainingHalfUnitsFor(14, [{ boxId: 1, quantityHalfUnits: 6 }]),
    ).toBe(8);
    expect(
      remainingHalfUnitsFor(14, [
        { boxId: 1, quantityHalfUnits: 6 },
        { boxId: 2, quantityHalfUnits: 8 },
      ]),
    ).toBe(0);
    // Ne descend jamais sous zéro même si, par construction, cela ne devrait
    // pas arriver.
    expect(
      remainingHalfUnitsFor(10, [{ boxId: 1, quantityHalfUnits: 20 }]),
    ).toBe(0);
  });

  it('réduit la quantité effective d’une boîte déjà partiellement retenue', () => {
    const first = box({ id: 1, remainingQuantity: 10 });
    const second = box({ id: 2, remainingQuantity: 8 });
    const effective = effectiveUsableBoxes(
      [first, second],
      [{ boxId: 1, quantityHalfUnits: 20 }],
    );
    expect(effective.find((item) => item.id === 1)?.remainingQuantity).toBe(0);
    expect(effective.find((item) => item.id === 2)?.remainingQuantity).toBe(8);
  });

  it('simule la fin d’une boîte puis le relais par une seconde pour le même médicament', () => {
    const almostEmpty = box({ id: 1, remainingQuantity: 3 });
    const fresh = box({ id: 2, remainingQuantity: 20 });
    const referenceDate = '2026-08-03';

    // Première boîte : ne couvre pas tout le besoin (14 demi-unités), elle
    // est prise intégralement.
    const first = verifyPreparationBox(
      '60000001',
      14,
      almostEmpty,
      [almostEmpty, fresh],
      referenceDate,
    );
    expect(first).toMatchObject({
      status: 'PARTIAL',
      quantityHalfUnits: 6,
      remainingAfterHalfUnits: 8,
    });

    const contributions = [{ boxId: 1, quantityHalfUnits: 6 }];
    const remaining = remainingHalfUnitsFor(14, contributions);
    expect(remaining).toBe(8);

    // Seconde boîte : couvre exactement ce qu'il reste, sans jamais
    // recompter la première.
    const effectiveBoxes = effectiveUsableBoxes(
      [almostEmpty, fresh],
      contributions,
    );
    const second = verifyPreparationBox(
      '60000001',
      remaining,
      effectiveBoxes.find((item) => item.id === 2)!,
      effectiveBoxes,
      referenceDate,
    );
    expect(second).toMatchObject({ status: 'VALID', quantityHalfUnits: 8 });
  });
});
