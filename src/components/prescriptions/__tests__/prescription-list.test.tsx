import { useEffect as mockUseEffect } from 'react';
import { AppState } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import PrescriptionsScreen from '@/app/prescriptions';
import type { Prescription } from '@/domain/prescriptions/prescription';
import {
  listPrescriptions,
  setPrescriptionArchived,
} from '@/infrastructure/prescriptions/prescription-repository';
import { AppCard } from '@/ui';

const mockDatabase = {};
const mockNavigate = jest.fn();
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDatabase }));
jest.mock('expo-router', () => ({
  usePathname: () => '/prescriptions',
  useFocusEffect: (effect: () => void | (() => void)) =>
    mockUseEffect(effect, [effect]),
  router: {
    navigate: (...args: unknown[]) => mockNavigate(...args),
    back: jest.fn(),
    push: jest.fn(),
  },
}));
jest.mock('@/infrastructure/prescriptions/prescription-repository', () => ({
  listPrescriptions: jest.fn(),
  setPrescriptionArchived: jest.fn(),
}));

let rows: Prescription[];
let screen: ReactTestRenderer;
function item(
  id: number,
  validUntil: string | null,
  archived = false,
): Prescription {
  return {
    id,
    label: `Ordonnance ${id}`,
    issueDate: '2026-01-01',
    validUntil,
    archived,
    status: 'ACTIVE',
  };
}
function buttons(label: string) {
  return screen.root.findAll(
    (node) =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
    { deep: false },
  );
}
function toggle() {
  return screen.root.findAll(
    (node) =>
      node.props.accessibilityState?.expanded !== undefined &&
      typeof node.props.onPress === 'function',
    { deep: false },
  )[0];
}
function visibleLabels() {
  return screen.root
    .findAllByType(AppCard)
    .map((node) => node.props.accessibilityLabel);
}
async function mount() {
  await act(async () => {
    screen = create(<PrescriptionsScreen />);
  });
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 16, 12));
  rows = [item(1, '2026-10-16'), item(2, '2026-09-01'), item(3, null, true)];
  jest
    .mocked(listPrescriptions)
    .mockImplementation(async () => rows.map((row) => ({ ...row })));
  jest
    .mocked(setPrescriptionArchived)
    .mockImplementation(async (_db, id, archived) => {
      rows = rows.map((row) => (row.id === id ? { ...row, archived } : row));
    });
});
afterEach(async () => {
  await act(async () => screen?.unmount());
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

it('replie par défaut, compte, trie et conserve l’accès aux détails', async () => {
  await mount();
  expect(visibleLabels()).toEqual(['Ordonnance 1, Expire bientôt']);
  expect(toggle().props.accessibilityState.expanded).toBe(false);
  expect(JSON.stringify(screen.toJSON())).toContain(
    'Ordonnances expirées et archivées (',
  );
  await act(async () => toggle().props.onPress());
  expect(visibleLabels()).toEqual([
    'Ordonnance 1, Expire bientôt',
    'Ordonnance 2, Expirée',
    'Ordonnance 3, Archivée',
  ]);
  await act(async () => buttons('Ordonnance 2, Expirée')[0].props.onPress());
  expect(mockNavigate).toHaveBeenCalledWith({
    pathname: '/prescriptions/[id]',
    params: { id: '2' },
  });
});

it('archive et restaure sans déplacer une ordonnance encore expirée dans la liste principale', async () => {
  await mount();
  await act(async () => buttons('Archiver')[0].props.onPress());
  expect(visibleLabels()).toEqual([]);
  await act(async () => toggle().props.onPress());
  expect(visibleLabels()).toEqual([
    'Ordonnance 1, Archivée',
    'Ordonnance 2, Expirée',
    'Ordonnance 3, Archivée',
  ]);
  await act(async () => buttons('Archiver')[0].props.onPress());
  expect(visibleLabels()).toContain('Ordonnance 2, Expirée · Archivée');
  await act(async () => buttons('Restaurer')[1].props.onPress());
  expect(visibleLabels()).toContain('Ordonnance 2, Expirée');
  expect(rows[1].archived).toBe(false);
});

it('recalcule à minuit local et au retour au premier plan', async () => {
  const listener = jest.spyOn(AppState, 'addEventListener');
  jest.setSystemTime(new Date(2026, 9, 16, 23, 59, 59));
  await mount();
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(visibleLabels()).toEqual([]);
  expect(rows[0].archived).toBe(false);
  // Retour à une date antérieure : le hook relit aussi la date au réveil.
  jest.setSystemTime(new Date(2026, 9, 16, 12));
  await act(async () => {
    listener.mock.calls[0][1]('active');
  });
  expect(visibleLabels()).toEqual(['Ordonnance 1, Expire bientôt']);
});

it('affiche les états vides et une erreur d’archivage sans retirer l’ordonnance', async () => {
  rows = [];
  await mount();
  await act(async () => toggle().props.onPress());
  expect(JSON.stringify(screen.toJSON())).toContain(
    'Aucune ordonnance expirée ou archivée',
  );
  await act(async () => screen.unmount());
  rows = [item(1, null)];
  await mount();
  jest
    .mocked(setPrescriptionArchived)
    .mockRejectedValueOnce(new Error('Échec SQLite'));
  await act(async () => buttons('Archiver')[0].props.onPress());
  expect(visibleLabels()).toEqual(['Ordonnance 1, Active']);
  expect(JSON.stringify(screen.toJSON())).toContain('Échec SQLite');
});
