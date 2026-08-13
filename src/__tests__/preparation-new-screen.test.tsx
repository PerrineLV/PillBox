import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { generatePreparationSnapshot } from '@/domain/preparations/preparation';
import type { MedicationBox } from '@/domain/inventory/inventory';
import {
  defaultControlledDispensingInfo,
  type Treatment,
} from '@/domain/treatments/treatment';
import { listMedicationBoxes } from '@/infrastructure/inventory/inventory-repository';
import { getGenericGroupMembers } from '@/infrastructure/medications/medication-reference';
import {
  completePreparation,
  createPreparation,
  getLatestDraftPreparation,
  listPreparationWeeks,
  savePreparationProgress,
  type SavedPreparationProgress,
} from '@/infrastructure/preparations/preparation-repository';
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
    const label = renderer.root
      .findAllByType(Text)
      .find((node) => JSON.stringify(node.props.children).includes(marker));
    if (!label) throw new Error(`Aucun texte contenant "${marker}" trouvé.`);
    let node: typeof label | null = label;
    while (node && typeof node.props.onPress !== 'function') node = node.parent;
    if (!node) throw new Error(`Aucun bouton parent pour "${marker}".`);
    (node.props as { onPress(): void }).onPress();
    await flush();
  });
}

function textOf(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

const SKIP_LABEL = 'Aucun stock disponible : laisser en attente de complément';

beforeEach(() => {
  jest.clearAllMocks();
  mockedListAllGenericEquivalenceConfirmations.mockResolvedValue([]);
  mockedGetGenericGroupMembers.mockResolvedValue([]);
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

    await press(renderer, 'Valider définitivement la préparation');
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
    const controlled = treatment({
      controlledDispensing: defaultControlledDispensingInfo(),
    });
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
      controlledDispensing: defaultControlledDispensingInfo(),
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

    await press(renderer, 'Valider ce médicament');

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
