import {
  buildBoxFillingGuide,
  buildMedicationFillingCells,
  parseBoxContribution,
} from '../box-filling-guide';
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

it.each([
  ['2', 4],
  ['0,5', 1],
  ['2.5', 5],
  ['7', 14],
  ['', null],
  ['0', null],
  ['-1', null],
  ['1,25', null],
  ['8', null],
  ['1e0', null],
])('valide la quantité explicitement saisie %s', (value, expected) => {
  expect(parseBoxContribution(String(value), 14)).toBe(expected);
});

describe('quantités dans les cases du médicament en cours', () => {
  it('déduit les dépôts partiels dans l’ordre chronologique sans arrondi', () => {
    const result = buildMedicationFillingCells([...items].reverse(), [
      { boxId: 1, quantityHalfUnits: 3 },
    ]);
    expect(result.find((cell) => cell.date === '2026-08-17')).toMatchObject({
      remainingHalfUnits: 0,
      depositedHalfUnits: 2,
    });
    expect(result.find((cell) => cell.date === '2026-08-18')).toMatchObject({
      remainingHalfUnits: 1,
      depositedHalfUnits: 1,
    });
    expect(result.find((cell) => cell.date === '2026-08-19')).toMatchObject({
      remainingHalfUnits: 2,
      depositedHalfUnits: 0,
    });
  });
  it('cumule les lignes d’une même case et les contributions de plusieurs boîtes', () => {
    const result = buildMedicationFillingCells(
      [items[0], { ...items[0], treatmentId: 2, quantityHalfUnits: 3 }],
      [
        { boxId: 1, quantityHalfUnits: 2 },
        { boxId: 2, quantityHalfUnits: 1 },
      ],
    );
    expect(result).toEqual([
      {
        date: '2026-08-17',
        slot: 'morning',
        remainingHalfUnits: 2,
        depositedHalfUnits: 3,
      },
    ]);
  });
  it('retrouve les quantités du snapshot après retrait d’une contribution', () => {
    expect(
      buildMedicationFillingCells(items, []).map(
        (cell) => cell.remainingHalfUnits,
      ),
    ).toEqual([2, 2, 2]);
  });
});
