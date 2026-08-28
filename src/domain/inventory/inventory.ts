export const STOCK_MOVEMENT_TYPES = [
  'BOX_ADDED',
  'MANUAL_ADJUSTMENT',
  'CORRECTION',
  'PILLBOX_PREPARATION',
  'OUTSIDE_PILLBOX_INTAKE',
] as const;

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

/**
 * Origine de la boîte : lue sur un DataMatrix ou saisie à la main. PillBox ne
 * doit jamais présenter une saisie manuelle comme une vérification par scan.
 */
export const MEDICATION_BOX_ORIGINS = ['SCAN', 'MANUAL'] as const;

export type MedicationBoxOrigin = (typeof MEDICATION_BOX_ORIGINS)[number];

export type MedicationBox = {
  id: number;
  specialtyCis: string;
  specialtyName: string;
  pharmaceuticalForm: string | null;
  presentationCip13: string;
  presentationLabel: string;
  lot: string | null;
  expirationDate: string;
  initialQuantity: number;
  remainingQuantity: number;
  origin: MedicationBoxOrigin;
  /** Chaîne brute du DataMatrix, absente pour une boîte ajoutée manuellement. */
  scanRaw: string | null;
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
  if (month < 1 || month > 12) return null;
  // GS1 encode parfois une péremption au mois près avec le jour `00` : il
  // représente alors le dernier jour de ce mois, sans modifier les autres
  // dates réellement invalides.
  const expirationDay =
    day === 0 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : day;
  const date = new Date(Date.UTC(year, month - 1, expirationDay));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== expirationDay
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(expirationDay).padStart(2, '0')}`;
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
  if (draft.origin === 'SCAN') {
    if (draft.scanRaw === null || draft.scanRaw.length === 0) {
      throw new Error('Le scan DataMatrix brut est requis.');
    }
    return;
  }
  if (draft.scanRaw !== null) {
    throw new Error(
      'Une boîte saisie manuellement ne peut pas revendiquer un scan DataMatrix.',
    );
  }
  // Sans DataMatrix, le lot est la seule façon de relier plus tard cette boîte
  // aux préparations : il est donc exigé plutôt que déduit.
  if ((draft.lot ?? '').trim() === '') {
    throw new Error(
      'Le lot est requis pour une boîte ajoutée sans DataMatrix.',
    );
  }
}

/**
 * Boîte déjà en stock partageant exactement le même lot pour la même
 * présentation, avec un stock restant positif — susceptible de trahir une
 * erreur de saisie du lot plutôt qu'un achat volontaire de plusieurs boîtes
 * identiques (ticket 33). Un lot vide n'a aucune valeur de comparaison ; une
 * boîte déjà épuisée n'est plus une source d'ambiguïté pour le remplissage.
 */
export function findDuplicateLotBox(
  existingBoxes: readonly MedicationBox[],
  presentationCip13: string,
  lot: string | null,
): MedicationBox | null {
  const trimmedLot = (lot ?? '').trim();
  if (trimmedLot === '') return null;
  return (
    existingBoxes.find(
      (box) =>
        box.presentationCip13 === presentationCip13 &&
        (box.lot ?? '').trim() === trimmedLot &&
        box.remainingQuantity > 0,
    ) ?? null
  );
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
