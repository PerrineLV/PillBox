import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { AppModal, PillButton } from '@/ui';
import type { MedicationBox } from '@/domain/inventory/inventory';
import BoxDetailScreen from '@/app/inventory/[id]';
import {
  adjustMedicationBox,
  discardExpiredMedicationBox,
  getMedicationBox,
  getMedicationBoxRemovalAction,
} from '@/infrastructure/inventory/inventory-repository';

jest.mock('expo-sqlite', () => {
  const database = {};
  return { useSQLiteContext: () => database };
});
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: '1' }),
  usePathname: () => '/inventory/1',
  router: { back: jest.fn(), replace: jest.fn() },
}));
jest.mock('@/ui/toast-provider', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));
jest.mock('@/components/medications/generic-group-section', () => ({
  GenericGroupSection: () => null,
}));
jest.mock('@/components/medications/orphan-box-generic-match', () => ({
  OrphanBoxGenericMatch: () => null,
}));
jest.mock('@/infrastructure/treatments/treatment-repository', () => ({
  listTreatments: async () => [],
}));
jest.mock('@/infrastructure/treatments/generic-equivalence-repository', () => ({
  listAllGenericEquivalenceConfirmations: async () => [],
}));
jest.mock('@/infrastructure/inventory/inventory-repository', () => ({
  getMedicationBox: jest.fn(),
  discardExpiredMedicationBox: jest.fn(async () => undefined),
  listStockMovements: async () => [],
  getMedicationBoxRemovalAction: jest.fn(async () => 'DELETE'),
  adjustMedicationBox: jest.fn(async () => undefined),
}));

const stockBox: MedicationBox = {
  id: 1,
  specialtyName: 'Test',
  specialtyCis: '60000001',
  initialQuantity: 30,
  remainingQuantity: 12.5,
  expirationDate: '2099-12-31',
  origin: 'MANUAL',
  lot: 'A',
  pharmaceuticalForm: 'comprimé',
  presentationCip13: '3400000000001',
  presentationLabel: 'Boîte',
  scanRaw: null,
};

let renderer: ReactTestRenderer;
const input = () =>
  renderer.root
    .findAllByType(TextInput)
    .find(
      (node) => node.props.accessibilityLabel === 'nouvelle quantité restante',
    )!;
const press = (label: string) => {
  const button = renderer.root.findAll(
    (node) =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  )[0];
  if (button) button.props.onPress();
  else
    renderer.root
      .findAllByType(PillButton)
      .find((node) => node.props.label === label)!
      .props.onPress();
};
const save = () => press('Enregistrer l’ajustement');

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(getMedicationBox).mockResolvedValue(stockBox);
  jest.mocked(getMedicationBoxRemovalAction).mockResolvedValue('DELETE');
  jest.mocked(discardExpiredMedicationBox).mockResolvedValue(undefined);
  await act(async () => {
    renderer = create(<BoxDetailScreen />);
  });
});
afterEach(() => {
  act(() => renderer.unmount());
});

it('préremplit le restant fractionnaire puis synchronise 90 et les boutons', async () => {
  expect(input().props.value).toBe('12.5');
  expect(input().props.keyboardType).toBe('decimal-pad');
  act(() => input().props.onChangeText('90'));
  act(() => press('Augmenter nouvelle quantité restante'));
  expect(input().props.value).toBe('91');
  act(() => press('Diminuer nouvelle quantité restante'));
  expect(input().props.value).toBe('90');
  await act(async () => {
    save();
    save();
  });
  expect(adjustMedicationBox).toHaveBeenCalledTimes(1);
  expect(adjustMedicationBox).toHaveBeenCalledWith(
    expect.anything(),
    1,
    90,
    'MANUAL_ADJUSTMENT',
    '',
  );
});

it.each(['', 'abc', '-1', '0.25', '9007199254740992'])(
  'refuse %s sans écriture ni perte du texte',
  async (text) => {
    act(() => input().props.onChangeText(text));
    await act(async () => save());
    expect(adjustMedicationBox).not.toHaveBeenCalled();
    expect(input().props.value).toBe(text);
    expect(JSON.stringify(renderer.toJSON())).toContain('Saisissez');
  },
);

it.each([
  ['0', 0],
  ['2,5', 2.5],
  ['1000000', 1000000],
])('enregistre %s comme stock final', async (text, expected) => {
  act(() => input().props.onChangeText(text));
  await act(async () => save());
  expect(adjustMedicationBox).toHaveBeenCalledWith(
    expect.anything(),
    1,
    expected,
    'MANUAL_ADJUSTMENT',
    '',
  );
});

it('annule sans écriture et restaure le stock réel', () => {
  act(() => input().props.onChangeText('90'));
  act(() => press('Annuler la saisie'));
  expect(input().props.value).toBe('12.5');
  expect(adjustMedicationBox).not.toHaveBeenCalled();
});

const discardLabel = 'Déstocker la boîte périmée';
const discardModal = () =>
  renderer.root
    .findAllByType(AppModal)
    .find((node) => node.props.primaryLabel === 'Confirmer le déstockage')!;
async function mountExpired(
  remainingQuantity = 12.5,
  expirationDate = '2000-01-01',
) {
  jest
    .mocked(getMedicationBox)
    .mockResolvedValue({ ...stockBox, remainingQuantity, expirationDate });
  jest
    .mocked(getMedicationBoxRemovalAction)
    .mockResolvedValue('KEEP_USED_IN_PREPARATION');
  await act(async () => {
    renderer.unmount();
  });
  await act(async () => {
    renderer = create(<BoxDetailScreen />);
  });
}

it('propose le déstockage même pour une boîte utilisée et confirme son lot et son restant', async () => {
  await mountExpired();
  await act(async () => press(discardLabel));
  expect(discardModal().props.visible).toBe(true);
  const text = JSON.stringify(renderer.toJSON());
  expect(text).toContain('lot A');
  expect(text).toContain('12.5 unité(s) restantes');
  expect(discardExpiredMedicationBox).not.toHaveBeenCalled();
  await act(async () => discardModal().props.onCancel());
  expect(discardModal().props.visible).toBe(false);
  expect(discardExpiredMedicationBox).not.toHaveBeenCalled();
});

it.each([
  [0, '2000-01-01'],
  [12.5, '2099-12-31'],
])(
  'masque l’action pour un restant %s et une péremption %s',
  async (remaining, expiration) => {
    await mountExpired(remaining, expiration);
    expect(
      renderer.root
        .findAllByType(PillButton)
        .some((node) => node.props.label === discardLabel),
    ).toBe(false);
  },
);

it('ne déstocke qu’une fois au double appui et recharge le restant après succès', async () => {
  await mountExpired();
  await act(async () => press(discardLabel));
  jest.mocked(getMedicationBox).mockResolvedValue({
    ...stockBox,
    remainingQuantity: 0,
    expirationDate: '2000-01-01',
  });
  await act(async () => {
    const confirm = discardModal().props.onPrimary;
    confirm();
    confirm();
  });
  expect(discardExpiredMedicationBox).toHaveBeenCalledTimes(1);
  expect(discardExpiredMedicationBox).toHaveBeenCalledWith(
    expect.anything(),
    1,
    12.5,
  );
  expect(input().props.value).toBe('0');
  expect(discardModal().props.visible).toBe(false);
  expect(
    renderer.root
      .findAllByType(PillButton)
      .some((node) => node.props.label === discardLabel),
  ).toBe(false);
});

it('affiche l’erreur et recharge le restant pour permettre une nouvelle confirmation', async () => {
  await mountExpired();
  await act(async () => press(discardLabel));
  jest
    .mocked(discardExpiredMedicationBox)
    .mockRejectedValueOnce(new Error('Le stock a changé.'));
  jest.mocked(getMedicationBox).mockResolvedValue({
    ...stockBox,
    remainingQuantity: 2.5,
    expirationDate: '2000-01-01',
  });
  await act(async () => discardModal().props.onPrimary());
  expect(discardModal().props.visible).toBe(true);
  expect(JSON.stringify(renderer.toJSON())).toContain('Le stock a changé.');
  expect(JSON.stringify(renderer.toJSON())).toContain('2.5 unité(s) restantes');
  await act(async () => discardModal().props.onPrimary());
  expect(discardExpiredMedicationBox).toHaveBeenLastCalledWith(
    expect.anything(),
    1,
    2.5,
  );
});
