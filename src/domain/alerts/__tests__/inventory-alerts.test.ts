import {
  buildInventoryAlerts,
  EXPIRATION_WARNING_DAYS,
  LOW_STOCK_MARGIN_PERCENT,
} from '../inventory-alerts';
import type { MedicationBox } from '@/domain/inventory/inventory';
import type { Treatment } from '@/domain/treatments/treatment';

const treatment = (): Treatment => ({
  id: 1,
  specialtyCis: '60000001',
  specialtyName: 'Alpha',
  pharmaceuticalForm: 'comprimé',
  active: true,
  includedInPillbox: true,
  archivedAt: null,
  phases: [
    {
      id: 1,
      startDate: '2026-01-01',
      endDate: null,
      frequency: { type: 'daily' },
      dosage: [{ slot: 'morning', quantityHalfUnits: 2 }],
    },
  ],
});

const box = (overrides: Partial<MedicationBox> = {}): MedicationBox => ({
  id: 1,
  specialtyCis: '60000001',
  specialtyName: 'Alpha',
  pharmaceuticalForm: 'comprimé',
  presentationCip13: '3400000000001',
  presentationLabel: 'Boîte',
  lot: 'LOT-A',
  serialNumber: null,
  expirationDate: '2027-01-01',
  initialQuantity: 30,
  remainingQuantity: 30,
  scanRaw: 'raw',
  ...overrides,
});

describe('alertes utiles au prochain pilulier', () => {
  it('documente les seuils par défaut', () => {
    expect(LOW_STOCK_MARGIN_PERCENT).toBe(25);
    expect(EXPIRATION_WARNING_DAYS).toBe(30);
  });

  it('calcule les besoins des sept jours à partir du lendemain', () => {
    const alerts = buildInventoryAlerts(
      [treatment()],
      [box({ remainingQuantity: 6 })],
      '2026-08-09',
    );
    expect(alerts).toMatchObject({
      startDate: '2026-08-10',
      endDate: '2026-08-16',
      stock: [
        {
          status: 'INSUFFICIENT',
          requiredHalfUnits: 14,
          usableStockHalfUnits: 12,
          missingHalfUnits: 2,
        },
      ],
    });
  });

  it('signale un stock suffisant mais situé dans la marge de 25 %', () => {
    expect(
      buildInventoryAlerts(
        [treatment()],
        [box({ remainingQuantity: 8 })],
        '2026-08-09',
      ).stock[0],
    ).toMatchObject({ status: 'CLOSE', usableStockHalfUnits: 16 });
    expect(
      buildInventoryAlerts(
        [treatment()],
        [box({ remainingQuantity: 10 })],
        '2026-08-09',
      ).stock,
    ).toEqual([]);
  });

  it('exclut le stock périmé avant de classer le niveau de stock', () => {
    const alerts = buildInventoryAlerts(
      [treatment()],
      [box({ expirationDate: '2026-08-08', remainingQuantity: 30 })],
      '2026-08-09',
    );
    expect(alerts.stock[0]).toMatchObject({
      status: 'INSUFFICIENT',
      usableStockHalfUnits: 0,
    });
  });

  it('signale uniquement les lots non vides expirant dans les 30 jours', () => {
    const alerts = buildInventoryAlerts(
      [],
      [
        box({ id: 1, expirationDate: '2026-08-09' }),
        box({ id: 2, expirationDate: '2026-09-08' }),
        box({ id: 3, expirationDate: '2026-09-09' }),
        box({ id: 4, expirationDate: '2026-08-08' }),
        box({ id: 5, expirationDate: '2026-08-20', remainingQuantity: 0 }),
      ],
      '2026-08-09',
    );
    expect(alerts.expirations.map((item) => item.boxId)).toEqual([1, 2]);
  });

  it('accepte des seuils configurés explicitement', () => {
    const alerts = buildInventoryAlerts(
      [treatment()],
      [box({ remainingQuantity: 9, expirationDate: '2026-10-08' })],
      '2026-08-09',
      { lowStockMarginPercent: 50, expirationWarningDays: 60 },
    );
    expect(alerts.stock[0]?.status).toBe('CLOSE');
    expect(alerts.expirations).toHaveLength(1);
  });
});
