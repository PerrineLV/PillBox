import type { GenericGroupMember } from '@/infrastructure/medications/medication-reference';

export type NamedGenericGroupMember = GenericGroupMember & { name: string };

/**
 * Regroupe les membres par groupe générique, en excluant ceux dont le nom
 * n'a pas pu être résolu dans le référentiel (CIS orphelin) : une entrée
 * sans nom n'est pas exploitable pour l'utilisatrice et serait davantage
 * source de confusion que d'information. Cela ne cache aucune donnée côté
 * import (`generic_groups`/`orphan_generic_groups` restent complets) : seul
 * cet affichage informatif filtre.
 */
export function groupNamedGenericGroupMembers(
  members: GenericGroupMember[],
): NamedGenericGroupMember[][] {
  const groups = new Map<string, NamedGenericGroupMember[]>();
  for (const member of members) {
    if (member.name === null) continue;
    const named: NamedGenericGroupMember = { ...member, name: member.name };
    const bucket = groups.get(named.groupId) ?? [];
    bucket.push(named);
    groups.set(named.groupId, bucket);
  }
  return [...groups.values()];
}
