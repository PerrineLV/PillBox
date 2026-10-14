import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { PillButton } from '@/ui';
import BoxDetailScreen from '@/app/inventory/[id]';
import { adjustMedicationBox } from '@/infrastructure/inventory/inventory-repository';

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
  getMedicationBox: async () => ({
    id: 1,
    specialtyName: 'Test',
    specialtyCis: '60000001',
    initialQuantity: 30,
    remainingQuantity: 12.5,
    expirationDate: '2027-12-31',
    origin: 'MANUAL',
    lot: 'A',
  }),
  listStockMovements: async () => [],
  getMedicationBoxRemovalAction: async () => 'DELETE',
  adjustMedicationBox: jest.fn(async () => undefined),
}));

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
