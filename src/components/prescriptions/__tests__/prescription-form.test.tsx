import {
  memo as mockMemo,
  useEffect as mockUseEffect,
  type ReactElement,
  type ReactNode,
} from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { Treatment } from '@/domain/treatments/treatment';
import { queueCreatedTreatmentForPrescription } from '@/infrastructure/prescriptions/pending-new-treatment-for-prescription';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';

import { PrescriptionForm } from '../prescription-form';

const mockedPush = jest.fn();
/**
 * Dernier callback de focus enregistré par `PrescriptionForm` : rejoué
 * manuellement pour simuler un retour d'écran (`router.dismissTo`, qui
 * préserve l'instance montée sans la démonter). Un tableau de dépendances
 * vide sur l'effet de montage évite toute boucle de rendu — rejouer le
 * callback via `mockLastFocusEffect()` reste la seule façon de simuler un
 * second focus dans ce test, sans conteneur de navigation réel.
 */
let mockLastFocusEffect: (() => void | (() => void)) | null = null;

// Alias préfixés « mock » : seule façon dont une factory `jest.mock` (hissée
// au-dessus des imports) peut légitimement fermer sur une variable du module.
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockedPush(...args) },
  usePathname: () => '/prescriptions/new',
  useFocusEffect: (effect: () => void | (() => void)) => {
    mockLastFocusEffect = effect;
    mockUseEffect(() => effect(), []);
  },
}));

jest.mock('@/infrastructure/treatments/treatment-repository', () => ({
  listTreatments: jest.fn(),
}));

// `SQLiteProvider` réel (expo-sqlite) est un `React.memo` dont le
// comparateur ignore `children` : une fois monté, toute mise à jour des
// enfants provenant d'un re-rendu du parent est silencieusement gelée. Ce
// mock reproduit fidèlement ce piège (comparateur toujours `true`) pour que
// les tests détectent une régression de ce type, au lieu du passthrough
// trivial d'origine qui masquait le bug réel.
jest.mock('expo-sqlite', () => ({
  useSQLiteContext: () => ({}),
  SQLiteProvider: mockMemo(
    ({ children }: { children: ReactNode }) => children,
    () => true,
  ),
}));

jest.mock('@/infrastructure/medications/medication-reference', () => ({
  detectControlledDispensingMention: jest.fn().mockResolvedValue(false),
}));

// Aucun test existant ne rend `DateField` : son module natif (jamais
// mocké par le preset `jest-expo`) bloque le rendu sans ce mock minimal.
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
}));

const mockedListTreatments = listTreatments as jest.Mock;

function treatment(overrides: Partial<Treatment> = {}): Treatment {
  return {
    id: 1,
    specialtyCis: '60000001',
    specialtyName: 'Alpha',
    pharmaceuticalForm: null,
    dosageKind: 'SCHEDULED',
    includedInPillbox: true,
    archivedAt: null,
    phases: [],
    asNeededInfo: { maxQuantityPerDayHalfUnits: null, minIntervalHours: null },
    ...overrides,
  };
}

function formElement(onSubmit: jest.Mock): ReactElement {
  return (
    <PrescriptionForm
      personalDatabase={{} as never}
      initialValue={{ label: '', issueDate: '2026-08-01', validUntil: null }}
      submitLabel="Créer l’ordonnance"
      onSubmit={onSubmit}
    />
  );
}

async function renderForm(onSubmit: jest.Mock): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(formElement(onSubmit));
    await Promise.resolve();
  });
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLastFocusEffect = null;
  mockedListTreatments.mockResolvedValue([treatment()]);
});

describe('validation du formulaire', () => {
  it('refuse la validation tant qu’une ligne n’a pas de traitement choisi', async () => {
    const onSubmit = jest.fn();
    const renderer = await renderForm(onSubmit);

    const addLine = renderer.root.findByProps({
      accessibilityLabel: 'Ajouter une ligne',
    });
    await act(async () => addLine.props.onPress());

    const submit = renderer.root.findByProps({
      accessibilityLabel: 'Créer l’ordonnance',
    });
    await act(async () => submit.props.onPress());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain(
      'Complétez ou retirez toute ligne sans traitement choisi',
    );
  });

  it('accepte une ordonnance sans aucune ligne (label et dates seuls)', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const renderer = await renderForm(onSubmit);

    const submit = renderer.root.findByProps({
      accessibilityLabel: 'Créer l’ordonnance',
    });
    await act(async () => submit.props.onPress());

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ newLines: [] }),
    );
  });
});

describe('renouvellement d’un traitement existant', () => {
  it('soumet une ligne de renouvellement correctement construite', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const renderer = await renderForm(onSubmit);

    await act(async () =>
      renderer.root
        .findByProps({ accessibilityLabel: 'Ajouter une ligne' })
        .props.onPress(),
    );
    await act(async () =>
      renderer.root
        .findByProps({
          accessibilityLabel: 'Renouveler un traitement existant',
        })
        .props.onPress(),
    );
    await act(async () =>
      renderer.root
        .findByProps({
          accessibilityLabel: 'Traitement à renouveler, Choisir un traitement',
        })
        .props.onPress(),
    );
    await act(async () =>
      renderer.root
        .findByProps({ accessibilityRole: 'menuitem' })
        .props.onPress(),
    );
    const durationField = renderer.root.findByProps({
      accessibilityLabel: 'Durée couverte (jours)',
    });
    await act(async () => durationField.props.onChangeText('28'));

    await act(async () =>
      renderer.root
        .findByProps({ accessibilityLabel: 'Créer l’ordonnance' })
        .props.onPress(),
    );

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        newLines: [
          expect.objectContaining({
            treatmentId: 1,
            quantityKind: 'DURATION',
            durationDays: 28,
            dispensingMode: 'FULL',
          }),
        ],
      }),
    );
  });
});

describe('ajout d’un nouveau traitement depuis une ligne', () => {
  it('navigue vers la recherche avec un retour vers l’écran courant', async () => {
    const renderer = await renderForm(jest.fn());
    await act(async () =>
      renderer.root
        .findByProps({ accessibilityLabel: 'Ajouter une ligne' })
        .props.onPress(),
    );

    await act(async () =>
      renderer.root
        .findByProps({ accessibilityLabel: 'Ajouter un nouveau traitement' })
        .props.onPress(),
    );

    expect(mockedPush).toHaveBeenCalledWith({
      pathname: '/medications/search',
      params: { returnTo: '/prescriptions/new' },
    });
  });

  it('rattache le traitement créé à la ligne en attente au retour sur l’écran', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const renderer = await renderForm(onSubmit);
    await act(async () =>
      renderer.root
        .findByProps({ accessibilityLabel: 'Ajouter une ligne' })
        .props.onPress(),
    );
    await act(async () =>
      renderer.root
        .findByProps({ accessibilityLabel: 'Ajouter un nouveau traitement' })
        .props.onPress(),
    );

    const created = treatment({
      id: 2,
      specialtyCis: '60000002',
      specialtyName: 'Beta',
    });
    mockedListTreatments.mockResolvedValue([treatment(), created]);
    queueCreatedTreatmentForPrescription(created.id);

    // Simule le retour sur l'écran (dismissTo préserve l'instance montée,
    // sans la démonter ni la remonter) : rejoue le dernier callback de focus
    // enregistré, qui dépile le traitement créé et l'attache à la ligne en
    // attente.
    await act(async () => {
      mockLastFocusEffect?.();
      await Promise.resolve();
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('Beta');
  });
});
