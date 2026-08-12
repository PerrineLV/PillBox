/**
 * Pont en mémoire, entre l'écran d'ajout de boîte et l'écran de création
 * d'un traitement (ticket 29) : une équivalence générique confirmée
 * explicitement pendant la création — avant que le traitement n'ait
 * d'identifiant — ne peut pas encore être mémorisée en base (la table
 * `generic_equivalence_confirmations` exige un `treatment_id`). Le choix est
 * donc mis en attente ici, puis dépilé par l'écran de création dès qu'il
 * regagne le focus, pour être enregistré juste après la création effective
 * du traitement. Jamais persisté : si l'application est tuée avant la
 * création du traitement, la mise en attente est perdue au même titre que le
 * reste du brouillon de traitement, sans incohérence.
 */
export type PendingGenericEquivalenceDraft = Readonly<{
  cis: string;
  specialtyName: string;
  groupLabel: string;
}>;

let queue: PendingGenericEquivalenceDraft[] = [];

export function queuePendingGenericEquivalenceDraft(
  draft: PendingGenericEquivalenceDraft,
): void {
  queue = [...queue, draft];
}

export function drainPendingGenericEquivalenceDrafts(): PendingGenericEquivalenceDraft[] {
  const drained = queue;
  queue = [];
  return drained;
}
