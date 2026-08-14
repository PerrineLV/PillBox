/**
 * Une ordonnance (ticket 45) : période de validité purement informative,
 * jamais bloquante. `status` n'est pas stocké : il est recalculé par le
 * repository à partir de `validUntil` et de la présence d'une ordonnance plus
 * récente couvrant au moins un même traitement (voir `computePrescriptionStatus`).
 */
export const PRESCRIPTION_STATUSES = ['ACTIVE', 'EXPIRED', 'REPLACED'] as const;
export type PrescriptionStatus = (typeof PRESCRIPTION_STATUSES)[number];

export type Prescription = {
  id: number;
  /** Texte libre court (ex. "ordo psychiatre") : jamais le nom du médecin. */
  label: string;
  issueDate: string;
  validUntil: string;
  status: PrescriptionStatus;
};

export type PrescriptionDraft = Omit<Prescription, 'id' | 'status'>;

/**
 * Ligne d'ordonnance reliant une `Prescription` à un `Treatment`. Un même
 * traitement peut avoir plusieurs `PrescriptionItem` dans le temps (une par
 * ordonnance qui l'a couvert) ; au plus un item « actif » par traitement a du
 * sens fonctionnellement, mais ce n'est pas contraint en base (ticket 45).
 */
export const PRESCRIPTION_ITEM_QUANTITY_KINDS = [
  'DURATION',
  'BOX_COUNT',
] as const;
export type PrescriptionItemQuantityKind =
  (typeof PRESCRIPTION_ITEM_QUANTITY_KINDS)[number];

export const PRESCRIPTION_ITEM_DISPENSING_MODES = [
  'FULL',
  'FRACTIONAL',
] as const;
export type PrescriptionItemDispensingMode =
  (typeof PRESCRIPTION_ITEM_DISPENSING_MODES)[number];

export type PrescriptionItem = {
  id: number;
  prescriptionId: number;
  treatmentId: number;
  quantityKind: PrescriptionItemQuantityKind;
  /** Nombre de jours couverts, uniquement pour `quantityKind: 'DURATION'`. */
  durationDays: number | null;
  /** Nombre de boîtes délivrées, uniquement pour `quantityKind: 'BOX_COUNT'`. */
  boxCount: number | null;
  dispensingMode: PrescriptionItemDispensingMode;
  /** Nombre de jours entre deux délivrances, uniquement en mode `FRACTIONAL`. */
  periodicityDays: number | null;
  lastDispensedAt: string | null;
  /**
   * Recalculée automatiquement depuis `lastDispensedAt` + `periodicityDays`
   * lorsque `lastDispensedAt` change, mais reste modifiable directement et
   * indépendamment (chevauchement exceptionnel d'ordonnances).
   */
  theoreticalRenewalDate: string | null;
  /**
   * Marge en jours autour de `theoreticalRenewalDate`, uniquement
   * significative en mode `FRACTIONAL`. `null`/0 pour une spécialité
   * détectée stupéfiant par la BDPM (périodicité déjà encadrée côté
   * pharmacie) ; une valeur raisonnable (ex. 3 jours) est suggérée par
   * l'UI pour les autres, modifiable ligne par ligne.
   */
  toleranceDays: number | null;
};

export type PrescriptionItemDraft = Omit<PrescriptionItem, 'id'>;

export const DEFAULT_FRACTIONAL_TOLERANCE_DAYS = 3;

/**
 * Suggestion affichée par l'UI de saisie (ticket 46), jamais appliquée
 * silencieusement : `null` pour une spécialité détectée stupéfiant par la
 * BDPM, une valeur raisonnable pour les autres, toujours modifiable.
 */
export function suggestedToleranceDays(
  isControlledSubstance: boolean,
): number | null {
  return isControlledSubstance ? null : DEFAULT_FRACTIONAL_TOLERANCE_DAYS;
}

export function computeTheoreticalRenewalDate(
  lastDispensedAt: string,
  periodicityDays: number,
): string {
  assertCivilDate(
    lastDispensedAt,
    'La date de dernière délivrance est invalide.',
  );
  if (!Number.isSafeInteger(periodicityDays) || periodicityDays <= 0)
    throw new Error(
      'La périodicité de délivrance doit être un nombre de jours positif.',
    );
  const date = new Date(`${lastDispensedAt}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + periodicityDays);
  return date.toISOString().slice(0, 10);
}

/**
 * `isReplaced` est déterminé par l'appelant (repository) : une ordonnance
 * plus récente couvre au moins un même traitement. Purement informatif,
 * jamais bloquant.
 */
export function computePrescriptionStatus(
  prescription: { validUntil: string },
  isReplaced: boolean,
  today: string,
): PrescriptionStatus {
  if (isReplaced) return 'REPLACED';
  return prescription.validUntil >= today ? 'ACTIVE' : 'EXPIRED';
}

export function assertValidPrescriptionDraft(draft: PrescriptionDraft): void {
  if (draft.label.trim() === '')
    throw new Error('L’ordonnance doit avoir un intitulé.');
  assertCivilDate(draft.issueDate, 'La date d’émission est invalide.');
  assertCivilDate(draft.validUntil, 'La date de fin de validité est invalide.');
  if (draft.validUntil < draft.issueDate)
    throw new Error('La fin de validité doit suivre la date d’émission.');
}

export function assertValidPrescriptionItemDraft(
  draft: PrescriptionItemDraft,
): void {
  if (draft.quantityKind === 'DURATION') {
    if (
      !Number.isSafeInteger(draft.durationDays) ||
      (draft.durationDays as number) <= 0
    )
      throw new Error(
        'La durée couverte doit être un nombre de jours positif.',
      );
    if (draft.boxCount !== null)
      throw new Error(
        'Un nombre de boîtes n’a pas de sens pour une ligne exprimée en durée.',
      );
  } else {
    if (
      !Number.isSafeInteger(draft.boxCount) ||
      (draft.boxCount as number) <= 0
    )
      throw new Error(
        'Le nombre de boîtes délivrées doit être un entier positif.',
      );
    if (draft.durationDays !== null)
      throw new Error(
        'Une durée n’a pas de sens pour une ligne exprimée en nombre de boîtes.',
      );
  }

  if (draft.dispensingMode === 'FULL') {
    if (
      draft.periodicityDays !== null ||
      draft.lastDispensedAt !== null ||
      draft.theoreticalRenewalDate !== null ||
      draft.toleranceDays !== null
    )
      throw new Error(
        'Une délivrance unique ne porte ni périodicité, ni date, ni tolérance.',
      );
    return;
  }

  if (
    !Number.isSafeInteger(draft.periodicityDays) ||
    (draft.periodicityDays as number) <= 0
  )
    throw new Error(
      'La périodicité de délivrance doit être un nombre de jours positif.',
    );
  if (draft.lastDispensedAt !== null)
    assertCivilDate(
      draft.lastDispensedAt,
      'La date de dernière délivrance est invalide.',
    );
  if (draft.theoreticalRenewalDate !== null)
    assertCivilDate(
      draft.theoreticalRenewalDate,
      'La date de renouvellement théorique est invalide.',
    );
  if (
    draft.toleranceDays !== null &&
    (!Number.isSafeInteger(draft.toleranceDays) || draft.toleranceDays < 0)
  )
    throw new Error(
      'La tolérance doit être un nombre de jours positif ou nul.',
    );
}

function assertCivilDate(value: string, message: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(message);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new Error(message);
}
