import { buildBoxFillingGuide } from '../box-filling-guide';
import type { MedicationBox } from '@/domain/inventory/inventory';
import type { PreparationItemSnapshot } from '@/domain/preparations/preparation';

const items: readonly PreparationItemSnapshot[] = [
  {
    treatmentId: 1,
    specialtyCis: '60000001',
    specialtyName: 'Alpha',
    pharmaceuticalForm: 'comprimé',
    date: '2026-08-17',
    slot: 'morning',
    quantityHalfUnits: 2,
  },
  {
    treatmentId: 1,
    specialtyCis: '60000001',
    specialtyName: 'Alpha',
    pharmaceuticalForm: 'comprimé',
    date: '2026-08-18',
    slot: 'morning',
    quantityHalfUnits: 2,
  },
  {
    treatmentId: 1,
    specialtyCis: '60000001',
    specialtyName: 'Alpha',
    pharmaceuticalForm: 'comprimé',
    date: '2026-08-19',
    slot: 'morning',
    quantityHalfUnits: 2,
  },
];

function box(id: number, remainingQuantity: number): MedicationBox {
  return {
    id,
    specialtyCis: '60000001',
    specialtyName: 'Alpha',
    pharmaceuticalForm: 'comprimé',
    presentationCip13: `340000000000${id}`,
    presentationLabel: 'Boîte',
    lot: `LOT-${id}`,
    expirationDate: '2027-01-01',
    initialQuantity: remainingQuantity,
    remainingQuantity,
    origin: 'SCAN',
    scanRaw: 'raw',
  };
}

describe('guidage de remplissage entre plusieurs boîtes', () => {
  it('répartit dans l’ordre des prises et annonce le passage à la boîte suivante', () => {
    const guide = buildBoxFillingGuide(
      items,
      [
        { boxId: 2, quantityHalfUnits: 2 },
        { boxId: 1, quantityHalfUnits: 4 },
      ],
      [box(1, 2), box(2, 1)],
    );

    expect(guide[0]).toMatchObject({
      remainingInBoxAfterHalfUnits: 0,
      segments: [
        {
          item: { date: '2026-08-17' },
          quantityHalfUnits: 2,
          completesItem: true,
        },
      ],
    });
    expect(guide[1]).toMatchObject({
      remainingInBoxAfterHalfUnits: 0,
      segments: [
        {
          item: { date: '2026-08-18' },
          quantityHalfUnits: 2,
          completesItem: true,
        },
        {
          item: { date: '2026-08-19' },
          quantityHalfUnits: 2,
          completesItem: true,
        },
      ],
    });
  });

  it('conserve une demi-unité attribuée à une prise sans l’arrondir', () => {
    const guide = buildBoxFillingGuide(
      items,
      [{ boxId: 1, quantityHalfUnits: 1 }],
      [box(1, 1)],
    );

    expect(guide[0].segments).toEqual([
      expect.objectContaining({ quantityHalfUnits: 1, completesItem: false }),
    ]);
    expect(guide[0].remainingInBoxAfterHalfUnits).toBe(1);
  });
});
