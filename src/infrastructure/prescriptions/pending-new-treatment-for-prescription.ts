/**
 * Pont en mémoire entre l'écran de création de traitement et l'écran
 * d'ordonnance qui l'a déclenché (ticket 46) : depuis une ligne d'ordonnance,
 * « Ajouter un nouveau traitement » navigue vers `/medications/search` puis
 * `/treatments/new`. Une fois le traitement créé, son id est déposé ici puis
 * dépilé par l'écran d'ordonnance dès qu'il regagne le focus (retour via
 * `router.dismissTo`, qui préserve son état sans le remonter), pour attacher
 * le traitement à la ligne qui attendait sa création. Jamais persisté : une
 * création interrompue avant son terme ne laisse rien en attente.
 */
let queuedTreatmentId: number | null = null;

export function queueCreatedTreatmentForPrescription(
  treatmentId: number,
): void {
  queuedTreatmentId = treatmentId;
}

export function drainCreatedTreatmentForPrescription(): number | null {
  const id = queuedTreatmentId;
  queuedTreatmentId = null;
  return id;
}
