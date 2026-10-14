import type { ReactNode } from 'react';
import { TextInput } from 'react-native';
import { CameraView } from 'expo-camera';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { generatePreparationSnapshot } from '@/domain/preparations/preparation';
import { todayIso } from '@/domain/inventory/inventory';
import { listIntakeHistory } from '@/infrastructure/intakes/intake-repository';
import { intakeRecordKey } from '@/domain/intakes/intake-tracking';
import type { MedicationBox } from '@/domain/inventory/inventory';
import type { PrescriptionItem } from '@/domain/prescriptions/prescription';
import type { Treatment } from '@/domain/treatments/treatment';
import { listMedicationBoxes } from '@/infrastructure/inventory/inventory-repository';
import { getGenericGroupMembers } from '@/infrastructure/medications/medication-reference';
import {
  completePreparation,
  createPreparation,
  getLatestDraftPreparation,
  listPreparationWeeks,
  savePreparationProgress,
  removePreparationContribution,
  type SavedPreparationProgress,
} from '@/infrastructure/preparations/preparation-repository';
import { listPrescriptionItems } from '@/infrastructure/prescriptions/prescription-repository';
import { schedulePendingCompletionReminderFor } from '@/infrastructure/reminders/pending-completion-reminder-scheduler';
import {
  confirmGenericEquivalence,
  isGenericEquivalenceConfirmed,
  listAllGenericEquivalenceConfirmations,
} from '@/infrastructure/treatments/generic-equivalence-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';

import NewPreparationScreen from '../app/preparations/new';

// Référence stable : `useSQLiteContext` renvoie la même connexion à chaque
// rendu en usage réel. Un objet recréé à chaque appel romprait l'identité
// attendue par les `useEffect` de l'écran (`[personalDatabase, ...]`,
// `[referenceDatabase, ...]`) et les ferait boucler indéfiniment.
const mockDatabase = {};
jest.mock('expo-sqlite', () => ({
  useSQLiteContext: () => mockDatabase,
  SQLiteProvider: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
  CameraView: ({ children }: { children?: ReactNode }) => children ?? null,
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  Stack: { Screen: () => null },
  usePathname: () => '/preparations/new',
}));

// Cet écran calcule les sept jours à venir au montage. Figer la date métier
// évite que l'attendu change selon le jour où la CI exécute ce test.
jest.mock('@/domain/inventory/inventory', () => ({
  ...jest.requireActual('@/domain/inventory/inventory'),
  todayIso: jest.fn(() => '2026-09-13'),
}));

jest.mock('@/infrastructure/intakes/intake-repository', () => ({
  listIntakeHistory: jest.fn(async () => []),
}));

jest.mock('@/infrastructure/inventory/inventory-repository', () => ({
  listMedicationBoxes: jest.fn(),
}));
jest.mock('@/infrastructure/medications/medication-reference', () => ({
  getGenericGroupMembers: jest.fn(),
}));
jest.mock('@/infrastructure/preparations/preparation-repository', () => ({
  cancelPreparation: jest.fn(),
  createPreparation: jest.fn(),
  completePreparation: jest.fn(),
  getLatestDraftPreparation: jest.fn(),
  listPreparationWeeks: jest.fn(),
  savePreparationProgress: jest.fn(),
  removePreparationContribution: jest.fn(),
}));
jest.mock('@/infrastructure/prescriptions/prescription-repository', () => ({
  listPrescriptionItems: jest.fn(),
}));
jest.mock(
  '@/infrastructure/reminders/pending-completion-reminder-scheduler',
  () => ({
    schedulePendingCompletionReminderFor: jest.fn(),
  }),
);
jest.mock('@/infrastructure/treatments/generic-equivalence-repository', () => ({
  confirmGenericEquivalence: jest.fn(),
  isGenericEquivalenceConfirmed: jest.fn(),
  listAllGenericEquivalenceConfirmations: jest.fn(),
}));
jest.mock('@/infrastructure/treatments/treatment-repository', () => ({
  listTreatments: jest.fn(),
}));

const mockedListMedicationBoxes = listMedicationBoxes as jest.Mock;
const mockedGetGenericGroupMembers = getGenericGroupMembers as jest.Mock;
const mockedCreatePreparation = createPreparation as jest.Mock;
const mockedCompletePreparation = completePreparation as jest.Mock;
const mockedGetLatestDraftPreparation = getLatestDraftPreparation as jest.Mock;
const mockedListPreparationWeeks = listPreparationWeeks as jest.Mock;
const mockedSavePreparationProgress = savePreparationProgress as jest.Mock;
const mockedSchedulePendingCompletionReminderFor =
  schedulePendingCompletionReminderFor as jest.Mock;
const mockedConfirmGenericEquivalence = confirmGenericEquivalence as jest.Mock;
const mockedIsGenericEquivalenceConfirmed =
  isGenericEquivalenceConfirmed as jest.Mock;
const mockedListAllGenericEquivalenceConfirmations =
  listAllGenericEquivalenceConfirmations as jest.Mock;
const mockedListTreatments = listTreatments as jest.Mock;
const mockedListPrescriptionItems = listPrescriptionItems as jest.Mock;

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
    ...overrides,
  };
}

function fractionalPrescriptionItem(
  overrides: Partial<PrescriptionItem> = {},
): PrescriptionItem {
  return {
    id: 1,
    prescriptionId: 1,
    treatmentId: 1,
    quantityKind: 'DURATION',
    durationDays: 28,
    boxCount: null,
    dispensingMode: 'FRACTIONAL',
    periodicityDays: 28,
    lastDispensedAt: null,
    theoreticalRenewalDate: null,
    toleranceDays: null,
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
    remainingQuantity: 20,
    origin: 'SCAN',
    scanRaw: 'raw',
    ...overrides,
  };
}

function savedProgress(
  overrides: Partial<SavedPreparationProgress> = {},
): SavedPreparationProgress {
  return {
    specialtyCis: '60000001',
    boxId: 1,
    quantityHalfUnits: 14,
    verification: 'SCAN',
    scanRaw: 'raw',
    nonFefoAcknowledged: false,
    matchedCis: null,
    matchedSpecialtyName: null,
    ...overrides,
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<NewPreparationScreen />);
    await flush();
  });
  return renderer;
}

async function press(
  renderer: ReactTestRenderer,
  accessibilityLabel: string,
): Promise<void> {
  await act(async () => {
    (
      renderer.root.findByProps({ accessibilityLabel }).props as {
        onPress(): void;
      }
    ).onPress();
    await flush();
  });
}

/** Sélectionne la boîte affichée dans la liste du stock à partir d'un extrait de son libellé. */
async function pressBoxRow(
  renderer: ReactTestRenderer,
  marker: string,
): Promise<void> {
  await act(async () => {
    const expected = marker.replace('Boîte #', 'Boîte numéro ');
    const node = renderer.root.findAll(
      (item) =>
        typeof item.props.accessibilityLabel === 'string' &&
        item.props.accessibilityLabel.startsWith(expected) &&
        typeof item.props.onPress === 'function',
    )[0];
    if (!node) throw new Error(`Aucune boîte ${expected}`);
    node.props.onPress();
    await flush();
  });
}

function textOf(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

const SKIP_LABEL = 'Aucun stock disponible : laisser en attente de complément';

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(todayIso).mockReturnValue('2026-09-13');
  jest.mocked(listIntakeHistory).mockResolvedValue([]);
  mockedListAllGenericEquivalenceConfirmations.mockResolvedValue([]);
  mockedGetGenericGroupMembers.mockResolvedValue([]);
  mockedListPrescriptionItems.mockResolvedValue([]);
});

describe('démarrage de la prochaine préparation', () => {
  it('ouvre directement les sept jours à venir sans demander de choisir une semaine', async () => {
    const single = treatment();
    const stockBox = box();
    mockedGetLatestDraftPreparation.mockResolvedValue(null);
    mockedListMedicationBoxes.mockResolvedValue([stockBox]);
    mockedListPreparationWeeks.mockResolvedValue([]);
    mockedListTreatments.mockResolvedValue([single]);
    mockedCreatePreparation.mockResolvedValue(88);

    const renderer = await renderScreen();

    expect(mockedCreatePreparation).toHaveBeenCalledTimes(1);
    expect(textOf(renderer)).not.toContain('Quelle semaine préparer');
    expect(textOf(renderer)).toContain('Médicament ');
    expect(textOf(renderer)).toContain('du 14 au 20 septembre');
    expect(textOf(renderer)).toContain('Alpha');
  });
});

describe('validation finale d’une préparation', () => {
  it('valide une préparation entièrement couverte et affiche la confirmation', async () => {
    const single = treatment();
    const stockBox = box({ remainingQuantity: 20 });
    const snapshot = generatePreparationSnapshot(
      [single],
      [stockBox],
      '2026-08-10',
      '2026-08-09',
    );
    const requirement = snapshot.requirements[0];

    mockedGetLatestDraftPreparation.mockResolvedValue({
      id: 42,
      snapshot,
      progress: [
        savedProgress({
          specialtyCis: requirement.specialtyCis,
          boxId: stockBox.id,
          quantityHalfUnits: requirement.requiredHalfUnits,
        }),
      ],
    });
    mockedListMedicationBoxes.mockResolvedValue([stockBox]);
    mockedListPreparationWeeks.mockResolvedValue([]);
    mockedListTreatments.mockResolvedValue([single]);
    mockedCompletePreparation.mockResolvedValue([]);

    const renderer = await renderScreen();

    expect(textOf(renderer)).toContain('Contrôle final jour par jour');

    await press(renderer, 'Valider la préparation');
    await press(renderer, 'Valider et décrémenter le stock');

    expect(mockedCompletePreparation).toHaveBeenCalledWith(
      expect.anything(),
      42,
      expect.any(String),
    );
    // Aucun traitement à délivrance encadrée : aucun rappel de complément.
    expect(mockedSchedulePendingCompletionReminderFor).not.toHaveBeenCalled();
    expect(textOf(renderer)).toContain('Préparation validée');
  });
});

describe('délivrance encadrée : passage en attente de complément', () => {
  it('permet de laisser un médicament à délivrance encadrée active en attente de complément', async () => {
    const controlled = treatment();
    const snapshot = generatePreparationSnapshot(
      [controlled],
      [],
      '2026-08-10',
      '2026-08-09',
    );

    mockedGetLatestDraftPreparation.mockResolvedValue({
      id: 1,
      snapshot,
      progress: [],
    });
    mockedListMedicationBoxes.mockResolvedValue([]);
    mockedListPreparationWeeks.mockResolvedValue([]);
    mockedListTreatments.mockResolvedValue([controlled]);
    mockedListPrescriptionItems.mockResolvedValue([
      fractionalPrescriptionItem({ treatmentId: controlled.id }),
    ]);

    const renderer = await renderScreen();

    expect(textOf(renderer)).toContain(SKIP_LABEL);

    await press(renderer, SKIP_LABEL);

    // Seul médicament de la semaine : le passer en attente vide `current`.
    expect(textOf(renderer)).toContain('Contrôle final jour par jour');
  });

  it('ne propose jamais ce bouton pour un traitement sans délivrance encadrée active', async () => {
    const ordinary = treatment();
    const snapshot = generatePreparationSnapshot(
      [ordinary],
      [],
      '2026-08-10',
      '2026-08-09',
    );

    mockedGetLatestDraftPreparation.mockResolvedValue({
      id: 2,
      snapshot,
      progress: [],
    });
    mockedListMedicationBoxes.mockResolvedValue([]);
    mockedListPreparationWeeks.mockResolvedValue([]);
    mockedListTreatments.mockResolvedValue([ordinary]);

    const renderer = await renderScreen();

    expect(textOf(renderer)).not.toContain(SKIP_LABEL);
  });

  it('ne propose pas non plus le bouton si un autre traitement (pas celui en cours) a le dispositif actif', async () => {
    const ordinary = treatment({ id: 1, specialtyCis: '60000001' });
    const controlledElsewhere = treatment({
      id: 2,
      specialtyCis: '60000002',
      specialtyName: 'Beta',
    });
    // Seul « ordinary » a un besoin dans cette semaine : « controlledElsewhere »
    // n'apparaît pas dans le snapshot mais reste dans les traitements chargés.
    const snapshot = generatePreparationSnapshot(
      [ordinary],
      [],
      '2026-08-10',
      '2026-08-09',
    );

    mockedGetLatestDraftPreparation.mockResolvedValue({
      id: 3,
      snapshot,
      progress: [],
    });
    mockedListMedicationBoxes.mockResolvedValue([]);
    mockedListPreparationWeeks.mockResolvedValue([]);
    mockedListTreatments.mockResolvedValue([ordinary, controlledElsewhere]);
    mockedListPrescriptionItems.mockResolvedValue([
      fractionalPrescriptionItem({ treatmentId: controlledElsewhere.id }),
    ]);

    const renderer = await renderScreen();

    expect(textOf(renderer)).not.toContain(SKIP_LABEL);
  });
});

describe('reprise d’une préparation depuis un brouillon sauvegardé', () => {
  it('recharge le brouillon existant sans regénérer ni reproposer le choix de semaine', async () => {
    const first = treatment({
      id: 1,
      specialtyCis: '60000001',
      specialtyName: 'Alpha',
    });
    const second = treatment({
      id: 2,
      specialtyCis: '60000002',
      specialtyName: 'Beta',
    });
    const boxA = box({
      id: 1,
      specialtyCis: '60000001',
      specialtyName: 'Alpha',
    });
    const boxB = box({
      id: 2,
      specialtyCis: '60000002',
      specialtyName: 'Beta',
    });
    const snapshot = generatePreparationSnapshot(
      [first, second],
      [boxA, boxB],
      '2026-08-10',
      '2026-08-09',
    );
    const alphaRequirement = snapshot.requirements.find(
      (item) => item.specialtyCis === '60000001',
    )!;

    mockedGetLatestDraftPreparation.mockResolvedValue({
      id: 7,
      snapshot,
      progress: [
        savedProgress({
          specialtyCis: alphaRequirement.specialtyCis,
          boxId: boxA.id,
          quantityHalfUnits: alphaRequirement.requiredHalfUnits,
        }),
      ],
    });
    mockedListMedicationBoxes.mockResolvedValue([boxA, boxB]);
    mockedListPreparationWeeks.mockResolvedValue([]);
    mockedListTreatments.mockResolvedValue([first, second]);

    const renderer = await renderScreen();

    expect(mockedCreatePreparation).not.toHaveBeenCalled();
    expect(textOf(renderer)).not.toContain('Quelle semaine préparer');
    expect(textOf(renderer)).toContain('Préparation reprise');
    // Le médicament déjà couvert (Alpha) n'est plus proposé : reste Beta.
    expect(textOf(renderer)).toContain('Beta');
  });
});

describe('confirmation d’une équivalence générique', () => {
  function setupGenericScenario(): { equivalentBox: MedicationBox } {
    const expected = treatment({
      id: 1,
      specialtyCis: '60000001',
      specialtyName: 'Médicament attendu',
    });
    const snapshot = generatePreparationSnapshot(
      [expected],
      [],
      '2026-08-10',
      '2026-08-09',
    );
    const equivalentBox = box({
      id: 9,
      specialtyCis: '60000002',
      specialtyName: 'Médicament équivalent',
      remainingQuantity: 20,
    });

    mockedGetLatestDraftPreparation.mockResolvedValue({
      id: 3,
      snapshot,
      progress: [],
    });
    mockedListMedicationBoxes.mockResolvedValue([equivalentBox]);
    mockedListPreparationWeeks.mockResolvedValue([]);
    mockedListTreatments.mockResolvedValue([expected]);
    mockedGetGenericGroupMembers.mockResolvedValue([
      {
        groupId: 'g1',
        groupLabel: 'Groupe générique X',
        cis: '60000002',
        name: 'Médicament équivalent',
        type: null,
      },
    ]);

    return { equivalentBox };
  }

  it('refuse silencieusement la boîte tant que la correspondance générique n’est pas confirmée', async () => {
    setupGenericScenario();
    mockedIsGenericEquivalenceConfirmed.mockResolvedValue(false);

    const renderer = await renderScreen();
    await press(renderer, 'Choisir la boîte dans le stock');
    await pressBoxRow(renderer, 'Boîte #');

    expect(textOf(renderer)).toContain('Correspondance générique détectée');

    await press(renderer, 'Annuler');

    expect(mockedConfirmGenericEquivalence).not.toHaveBeenCalled();
    expect(mockedSavePreparationProgress).not.toHaveBeenCalled();
    expect(textOf(renderer)).toContain(
      'Produit différent détecté : Médicament équivalent. Boîte refusée.',
    );
  });

  it('n’accepte la boîte qu’après confirmation explicite, puis mémorise l’équivalence', async () => {
    setupGenericScenario();
    mockedIsGenericEquivalenceConfirmed.mockResolvedValue(false);
    mockedConfirmGenericEquivalence.mockResolvedValue(undefined);
    mockedSavePreparationProgress.mockResolvedValue(undefined);

    const renderer = await renderScreen();
    await press(renderer, 'Choisir la boîte dans le stock');
    await pressBoxRow(renderer, 'Boîte #');

    expect(textOf(renderer)).toContain('Correspondance générique détectée');

    await press(renderer, 'Confirmer cette correspondance');

    expect(mockedConfirmGenericEquivalence).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        treatmentId: 1,
        cis: '60000002',
        specialtyName: 'Médicament équivalent',
        groupLabel: 'Groupe générique X',
      }),
    );
    // La modale de confirmation a laissé place à la vérification de la boîte.
    expect(textOf(renderer)).not.toContain('Correspondance générique détectée');
    expect(textOf(renderer)).toContain('Équivalence générique confirmée');

    await press(renderer, 'Confirmer la quantité prélevée');

    expect(mockedSavePreparationProgress).toHaveBeenCalledWith(
      expect.anything(),
      3,
      expect.objectContaining({
        specialtyCis: '60000001',
        matchedCis: '60000002',
        matchedSpecialtyName: 'Médicament équivalent',
      }),
    );
  });

  it('accepte silencieusement une boîte déjà confirmée pour ce couple (traitement, CIS)', async () => {
    setupGenericScenario();
    mockedIsGenericEquivalenceConfirmed.mockResolvedValue(true);
    mockedSavePreparationProgress.mockResolvedValue(undefined);

    const renderer = await renderScreen();
    await press(renderer, 'Choisir la boîte dans le stock');
    await pressBoxRow(renderer, 'Boîte #');

    // Déjà confirmée : passe directement à la vérification, sans redemander.
    expect(textOf(renderer)).not.toContain('Correspondance générique détectée');
    expect(mockedConfirmGenericEquivalence).not.toHaveBeenCalled();
    expect(textOf(renderer)).toContain('Équivalence générique confirmée');
  });
});

describe('ticket 106 — répartition par boîte', () => {
  async function setupSplit(sameLot = false) {
    const boxes = [
      box({
        id: 1,
        presentationCip13: '3400000000005',
        lot: 'LOT-A',
        remainingQuantity: 10,
      }),
      box({
        id: 2,
        presentationCip13: '3400000000005',
        lot: sameLot ? 'LOT-A' : 'LOT-B',
        remainingQuantity: 10,
      }),
    ];
    mockedGetLatestDraftPreparation.mockResolvedValue({
      id: 3,
      snapshot: generatePreparationSnapshot(
        [treatment()],
        boxes,
        '2026-09-14',
        '2026-09-13',
      ),
      progress: [],
    });
    mockedListMedicationBoxes.mockResolvedValue(boxes);
    mockedListPreparationWeeks.mockResolvedValue([]);
    mockedListTreatments.mockResolvedValue([treatment()]);
    mockedSavePreparationProgress.mockResolvedValue(undefined);
    jest.mocked(removePreparationContribution).mockResolvedValue(undefined);
    return renderScreen();
  }

  async function scan(renderer: ReactTestRenderer, lot: string) {
    await press(renderer, 'Scanner la boîte utilisée');
    await act(async () => {
      renderer.root.findByType(CameraView).props.onBarcodeScanned({
        data: `]d201034000000000051727010110${lot}`,
        type: 'datamatrix',
      });
      await flush();
    });
  }

  async function quantity(renderer: ReactTestRenderer, value: string) {
    await act(async () => {
      renderer.root.findByType(TextInput).props.onChangeText(value);
    });
  }

  it.each([false, true])(
    'conserve 2 unités dans A et 5 dans B après le second scan (même lot : %s)',
    async (sameLot) => {
      const renderer = await setupSplit(sameLot);
      await scan(renderer, 'LOT-A');
      if (sameLot) await pressBoxRow(renderer, 'Boîte #1');
      await quantity(renderer, '2');
      await press(renderer, 'Confirmer la quantité prélevée');
      await scan(renderer, sameLot ? 'LOT-A' : 'LOT-B');
      if (sameLot) await pressBoxRow(renderer, 'Boîte #2');
      expect(mockedSavePreparationProgress).toHaveBeenCalledTimes(1);
      expect(renderer.root.findByType(TextInput).props.value).toBe('5');
      await press(renderer, 'Confirmer le prélèvement malgré l’avertissement');
      expect(
        mockedSavePreparationProgress.mock.calls.map((call) => [
          call[2].boxId,
          call[2].quantityHalfUnits,
        ]),
      ).toEqual([
        [1, 4],
        [2, 10],
      ]);
      expect(textOf(renderer)).toContain('Lots retenus pour cette semaine');
      expect(textOf(renderer)).toContain(
        'Corriger le prélèvement dans la boîte #1',
      );
    },
  );

  it('cumule un second prélèvement de la même boîte sans perdre la première quantité', async () => {
    const renderer = await setupSplit();
    await scan(renderer, 'LOT-A');
    await quantity(renderer, '2');
    await press(renderer, 'Confirmer la quantité prélevée');
    await scan(renderer, 'LOT-A');
    await press(renderer, 'Confirmer la quantité prélevée');
    expect(
      mockedSavePreparationProgress.mock.calls.map(
        (call) => call[2].quantityHalfUnits,
      ),
    ).toEqual([4, 14]);
    expect(textOf(renderer)).toContain('Lots retenus pour cette semaine');
  });

  it('corrige une affectation sans supprimer celle de l’autre boîte', async () => {
    const renderer = await setupSplit();
    await scan(renderer, 'LOT-A');
    await quantity(renderer, '2');
    await press(renderer, 'Confirmer la quantité prélevée');
    await scan(renderer, 'LOT-B');
    await press(renderer, 'Confirmer le prélèvement malgré l’avertissement');
    await press(renderer, 'Corriger le prélèvement dans la boîte #1');
    await press(renderer, 'Retirer l’affectation et la ressaisir');
    expect(removePreparationContribution).toHaveBeenCalledWith(
      mockDatabase,
      3,
      '60000001',
      1,
    );
    await scan(renderer, 'LOT-A');
    expect(renderer.root.findByType(TextInput).props.value).toBe('2');
  });
});

describe('ticket 108 — préparation du lundi', () => {
  it.each([false, true])(
    'inclut le lundi, même après le créneau du matin (prise renseignée : %s)',
    async (recorded) => {
      jest.mocked(todayIso).mockReturnValue('2026-09-14');
      mockedGetLatestDraftPreparation.mockResolvedValue(null);
      mockedListMedicationBoxes.mockResolvedValue([box()]);
      mockedListPreparationWeeks.mockResolvedValue([]);
      mockedListTreatments.mockResolvedValue([treatment()]);
      mockedCreatePreparation.mockResolvedValue(88);
      if (recorded)
        jest.mocked(listIntakeHistory).mockResolvedValue([
          {
            key: intakeRecordKey(1, '2026-09-14', 'morning'),
            treatmentId: 1,
            date: '2026-09-14',
            slot: 'morning',
            specialtyCis: '60000001',
            specialtyName: 'Alpha',
            pharmaceuticalForm: null,
            quantityHalfUnits: 2,
            status: 'TAKEN',
            createdAt: '',
            updatedAt: '',
          },
        ]);
      const renderer = await renderScreen();
      const snapshot = mockedCreatePreparation.mock.calls[0][1];
      expect(snapshot.startDate).toBe('2026-09-14');
      expect(snapshot.endDate).toBe('2026-09-20');
      expect(snapshot.items).toHaveLength(recorded ? 6 : 7);
      expect(snapshot.requirements[0].requiredHalfUnits).toBe(
        recorded ? 12 : 14,
      );
      expect(textOf(renderer)).toContain('Le pilulier inclut aujourd’hui');
    },
  );

  it('ne crée pas de doublon le lundi si la période a été préparée le dimanche', async () => {
    jest.mocked(todayIso).mockReturnValue('2026-09-14');
    mockedGetLatestDraftPreparation.mockResolvedValue(null);
    mockedListMedicationBoxes.mockResolvedValue([box()]);
    mockedListPreparationWeeks.mockResolvedValue([
      { id: 1, startDate: '2026-09-14', status: 'COMPLETED' },
    ]);
    mockedListTreatments.mockResolvedValue([treatment()]);
    const renderer = await renderScreen();
    expect(mockedCreatePreparation).not.toHaveBeenCalled();
    expect(textOf(renderer)).toContain('Semaine déjà préparée');
  });
});
