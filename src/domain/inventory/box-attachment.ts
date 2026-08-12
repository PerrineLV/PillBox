import {
  buildAcceptedCisIndex,
  type TreatmentGenericEquivalence,
} from '@/domain/preparations/preparation';
import type { Treatment } from '@/domain/treatments/treatment';

import type { MedicationBox } from './inventory';

/**
 * CIS rattachés à au moins un traitement actif : le CIS exact d'un traitement
 * actif, ou une équivalence générique mémorisée (ticket 24) pour un
 * traitement actif portant ce CIS. Un traitement archivé ne rattache jamais
 * de boîte, y compris via une équivalence qui lui a été confirmée : ce
 * signal doit rester dynamique, jamais figé au moment de l'ajout de la
 * boîte.
 */
export function buildAttachedSpecialtyCisSet(
  treatments: readonly Treatment[],
  equivalences: readonly TreatmentGenericEquivalence[],
): ReadonlySet<string> {
  const activeTreatments = treatments.filter(
    (treatment) => treatment.archivedAt === null,
  );
  const acceptedCisIndex = buildAcceptedCisIndex(
    activeTreatments,
    equivalences,
  );
  const attached = new Set<string>();
  for (const acceptedCis of acceptedCisIndex.values()) {
    for (const cis of acceptedCis) attached.add(cis);
  }
  return attached;
}

/**
 * Une boîte est orpheline si son médicament ne correspond, ni par CIS exact
 * ni par équivalence générique mémorisée, à aucun traitement actif. Ce
 * signal n'a aucune incidence sur le calcul des besoins ni sur les alertes
 * de stock existants : il informe, sans jamais créer ou suggérer de lien.
 */
export function isOrphanBox(
  box: MedicationBox,
  attachedSpecialtyCis: ReadonlySet<string>,
): boolean {
  return !attachedSpecialtyCis.has(box.specialtyCis);
}

/**
 * Symétrique de `isOrphanBox` (ticket 29), vu depuis le traitement plutôt que
 * depuis la boîte : un traitement n'a aucune boîte correspondante si aucune
 * boîte du stock ne porte, ni son CIS exact, ni un CIS accepté pour lui via
 * une équivalence générique mémorisée (ticket 24). `treatmentId` vaut `null`
 * pour un traitement en cours de création, pas encore enregistré : aucune
 * équivalence n'a alors pu être mémorisée pour lui en base, seul le CIS
 * exact compte — sauf les équivalences que l'utilisatrice vient de confirmer
 * explicitement pendant cette même création, encore en attente d'un
 * identifiant pour être écrites (`pendingCis`, ticket 29) : déjà des choix
 * explicites, elles comptent aussi, pour ne jamais afficher un signal que la
 * confirmation qu'elle vient de donner contredirait.
 */
export function isTreatmentWithoutStock(
  specialtyCis: string,
  treatmentId: number | null,
  boxes: readonly MedicationBox[],
  equivalences: readonly TreatmentGenericEquivalence[],
  pendingCis: readonly string[] = [],
): boolean {
  const acceptedCis = new Set<string>([specialtyCis, ...pendingCis]);
  if (treatmentId !== null) {
    for (const equivalence of equivalences) {
      if (equivalence.treatmentId === treatmentId) {
        acceptedCis.add(equivalence.cis);
      }
    }
  }
  return !boxes.some((box) => acceptedCis.has(box.specialtyCis));
}
