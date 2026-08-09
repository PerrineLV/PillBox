export const STOCK_MOVEMENT_TYPES = [
  'BOX_ADDED',
  'MANUAL_ADJUSTMENT',
  'CORRECTION',
  'PILLBOX_PREPARATION',
] as const;

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export type MedicationBox = {
  id: number;
  specialtyCis: string;
  specialtyName: string;
  pharmaceuticalForm: string | null;
  presentationCip13: string;
  presentationLabel: string;
  lot: string | null;
  serialNumber: string | null;
  expirationDate: string;
  initialQuantity: number;
  remainingQuantity: number;
  scanRaw: string;
};

export type MedicationBoxDraft = Omit<
  MedicationBox,
  'id' | 'remainingQuantity'
>;

export type StockMovement = {
  id: number;
  boxId: number;
  type: StockMovementType;
  quantityDelta: number;
  quantityAfter: number;
  explanation: string;
  createdAt: string;
};

export function isExpired(expirationDate: string, today: string): boolean {
  assertIsoDate(expirationDate);
  assertIsoDate(today);
  return expirationDate < today;
}

export function usableQuantity(box: MedicationBox, today: string): number {
  return isExpired(box.expirationDate, today) ? 0 : box.remainingQuantity;
}

export function parseGs1Expiration(value: string): string | null {
  if (!/^\d{6}$/.test(value)) return null;
  const year = 2000 + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  if (month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function assertValidBoxDraft(draft: MedicationBoxDraft): void {
  if (
    draft.specialtyCis.trim() === '' ||
    draft.specialtyName.trim() === '' ||
    !/^\d{13}$/.test(draft.presentationCip13)
  ) {
    throw new Error('Le médicament doit être identifié sans ambiguïté.');
  }
  assertIsoDate(draft.expirationDate);
  if (!Number.isInteger(draft.initialQuantity) || draft.initialQuantity <= 0) {
    throw new Error('La quantité initiale doit être un nombre entier positif.');
  }
  if (draft.scanRaw.length === 0) {
    throw new Error('Le scan DataMatrix brut est requis.');
  }
}

export function assertIsoDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('La péremption doit être au format AAAA-MM-JJ.');
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('La date de péremption est invalide.');
  }
}

export function todayIso(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
