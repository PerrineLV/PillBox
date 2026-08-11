export type AsNeededIntakeRecord = Readonly<{
  id: number;
  treatmentId: number;
  takenAt: string;
  quantityHalfUnits: number;
  note: string | null;
  createdAt: string;
}>;

export type AsNeededIntakeDraft = Readonly<{
  treatmentId: number;
  takenAt: string;
  quantityHalfUnits: number;
  note: string | null;
}>;

/**
 * Une prise « si besoin » n'a pas de créneau planifié : son identité n'a donc
 * pas besoin d'être déterministe comme celle d'une prise planifiée (13b), elle
 * est simplement enregistrée à la demande de l'utilisatrice.
 */
export function assertValidAsNeededIntakeDraft(
  draft: AsNeededIntakeDraft,
): void {
  if (!Number.isSafeInteger(draft.treatmentId) || draft.treatmentId <= 0)
    throw new Error('Traitement invalide.');
  assertValidIsoDateTime(draft.takenAt);
  if (
    !Number.isSafeInteger(draft.quantityHalfUnits) ||
    draft.quantityHalfUnits <= 0
  )
    throw new Error('La quantité prise doit être un multiple positif de 0,5.');
}

function assertValidIsoDateTime(value: string): void {
  if (Number.isNaN(new Date(value).getTime()))
    throw new Error('Date et heure de prise invalides.');
}
