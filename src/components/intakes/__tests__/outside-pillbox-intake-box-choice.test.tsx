import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { IntakeRecord } from '@/domain/intakes/intake-tracking';
import type { MedicationBox } from '@/domain/inventory/inventory';
import { takeOutsidePillboxIntake } from '@/infrastructure/intakes/intake-repository';
import { listMedicationBoxes } from '@/infrastructure/inventory/inventory-repository';
import { listGenericEquivalenceConfirmations } from '@/infrastructure/treatments/generic-equivalence-repository';
import { AppModal, DenseRow } from '@/ui';
import { OutsidePillboxIntakeBoxChoice } from '../outside-pillbox-intake-box-choice';

jest.mock('@/infrastructure/intakes/intake-repository');
jest.mock('@/infrastructure/inventory/inventory-repository');
jest.mock('@/infrastructure/treatments/generic-equivalence-repository');

const database = {} as SQLiteDatabase;
const record: IntakeRecord = {
  key: '1:2026-10-15:evening',
  treatmentId: 1,
  date: '2026-10-15',
  slot: 'evening',
  specialtyCis: 'A',
  specialtyName: 'Alpha',
  pharmaceuticalForm: 'comprimé',
  quantityHalfUnits: 4,
  status: 'UNSET',
  createdAt: '',
  updatedAt: '',
};
function box(
  id: number,
  remainingQuantity: number,
  expirationDate = '2099-01-01',
): MedicationBox {
  return {
    id,
    remainingQuantity,
    expirationDate,
    specialtyCis: 'A',
    specialtyName: 'Alpha',
    pharmaceuticalForm: 'comprimé',
    presentationCip13: '123',
    presentationLabel: 'Boîte',
    lot: String(id),
    initialQuantity: 30,
    origin: 'MANUAL',
    scanRaw: null,
  };
}

let renderer: ReactTestRenderer;
const onTaken = jest.fn(async () => {});
function element(current: IntakeRecord | null = record) {
  return (
    <OutsidePillboxIntakeBoxChoice
      database={database}
      record={current}
      onCancel={() => {}}
      onTaken={onTaken}
    />
  );
}
async function renderBoxes(boxes: MedicationBox[]) {
  jest.mocked(listMedicationBoxes).mockResolvedValue(boxes);
  await act(async () => {
    renderer = create(element());
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(listGenericEquivalenceConfirmations).mockResolvedValue([]);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
});

it('masque les boîtes vides et conserve les boîtes non vides insuffisantes ou périmées', async () => {
  await renderBoxes([
    box(1, 0),
    box(2, 30),
    box(3, 0.5),
    box(4, 10, '2000-01-01'),
    { ...box(5, 30), specialtyCis: 'B' },
  ]);
  const rows = renderer.root.findAllByType(DenseRow);
  expect(rows.map((row) => row.props.accessibilityLabel)).toEqual([
    'Boîte numéro 4, lot 4',
    'Boîte numéro 2, lot 2',
    'Boîte numéro 3, lot 3',
  ]);
  expect(rows.map((row) => row.props.disabled)).toEqual([true, false, true]);
  expect(JSON.stringify(renderer.toJSON())).toContain('Stock insuffisant');
  expect(JSON.stringify(renderer.toJSON())).toContain('Périmée');
});

it('affiche un état vide sans inviter à choisir une boîte et ne valide rien', async () => {
  await renderBoxes([box(1, 0)]);
  expect(renderer.root.findAllByType(DenseRow)).toHaveLength(0);
  const text = JSON.stringify(renderer.toJSON());
  expect(text).toContain('Aucune boîte correspondante');
  expect(text).not.toContain('Choisissez une boîte avant de confirmer.');
  await act(async () => renderer.root.findByType(AppModal).props.onPrimary());
  expect(takeOutsidePillboxIntake).not.toHaveBeenCalled();
  expect(onTaken).not.toHaveBeenCalled();
});

it('recharge le stock à la réouverture et retire une boîte désormais vide', async () => {
  await renderBoxes([box(1, 2)]);
  await act(async () => renderer.root.findByType(DenseRow).props.onPress());
  await act(async () => renderer.root.findByType(AppModal).props.onPrimary());
  expect(takeOutsidePillboxIntake).toHaveBeenCalledWith(
    database,
    record.key,
    1,
    expect.any(String),
  );
  await act(async () => renderer.update(element(null)));
  jest.mocked(listMedicationBoxes).mockResolvedValue([box(1, 0)]);
  await act(async () => renderer.update(element()));
  expect(renderer.root.findAllByType(DenseRow)).toHaveLength(0);
  await act(async () => renderer.root.findByType(AppModal).props.onPrimary());
  expect(takeOutsidePillboxIntake).toHaveBeenCalledTimes(1);
});
