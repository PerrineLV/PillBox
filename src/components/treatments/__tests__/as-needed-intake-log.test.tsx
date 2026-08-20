import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AsNeededIntakeLog } from '../as-needed-intake-log';
import { recordAsNeededIntake } from '@/infrastructure/intakes/as-needed-intake-repository';

const mockShowToast = jest.fn();
const mockDatabase = {};

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: jest.fn(() => mockDatabase),
}));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('@/infrastructure/intakes/as-needed-intake-repository', () => ({
  getLastAsNeededIntake: jest.fn(async () => null),
  listAsNeededIntakes: jest.fn(async () => []),
  recordAsNeededIntake: jest.fn(async () => undefined),
}));
jest.mock('@/ui', () => {
  const { Text, TextInput, View, Pressable } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    AppButton: ({
      label,
      onPress,
      loading,
    }: {
      label: string;
      onPress(): void;
      loading?: boolean;
    }) => (
      <Pressable
        accessibilityLabel={label}
        disabled={loading}
        onPress={onPress}
      >
        <Text>{label}</Text>
      </Pressable>
    ),
    AppField: ({
      label,
      value,
      onChangeText,
    }: {
      label: string;
      value: string;
      onChangeText(value: string): void;
    }) => (
      <TextInput
        accessibilityLabel={label}
        onChangeText={onChangeText}
        value={value}
      />
    ),
    Card: View,
    LoadingState: () => null,
    Message: ({ children }: { children: string }) => <Text>{children}</Text>,
    SectionTitle: ({ children }: { children: string }) => (
      <Text>{children}</Text>
    ),
    colors: { brandSoft: '#E5EFE9', border: '#DDD8CD' },
    radii: { md: 14 },
    sizes: { touch: 48 },
    spacing: { md: 12, sm: 8, xs: 4 },
    typography: { body: {}, caption: {}, label: {} },
    useToast: () => ({ showToast: mockShowToast }),
  };
});

const mockedRecord = jest.mocked(recordAsNeededIntake);

async function render(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<AsNeededIntakeLog canRecord treatmentId={7} />);
  });
  return renderer;
}

describe('AsNeededIntakeLog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('enregistre immédiatement une unité sans note et confirme par toast', async () => {
    const renderer = await render();
    await act(async () => {
      renderer.root
        .findByProps({ accessibilityLabel: 'Prise maintenant' })
        .props.onPress();
    });

    expect(mockedRecord).toHaveBeenCalledWith(
      mockDatabase,
      expect.objectContaining({
        treatmentId: 7,
        quantityHalfUnits: 2,
        note: null,
        takenAt: expect.any(String),
      }),
    );
    expect(mockShowToast).toHaveBeenCalledWith('Prise enregistrée.', 'success');
  });

  it('garde les détails repliés et n’affiche aucun champ de note', async () => {
    const renderer = await render();
    expect(JSON.stringify(renderer)).not.toContain('Note (optionnel)');
    expect(JSON.stringify(renderer)).not.toContain('Quantité prise');

    await act(async () => {
      renderer.root
        .findByProps({
          accessibilityLabel: 'Modifier la date, l’heure ou la quantité',
        })
        .props.onPress();
    });
    expect(JSON.stringify(renderer)).toContain('Quantité prise');
    expect(JSON.stringify(renderer)).not.toContain('Note (optionnel)');
  });
});
