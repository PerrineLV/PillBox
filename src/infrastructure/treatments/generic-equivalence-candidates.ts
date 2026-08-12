import type { SQLiteDatabase } from 'expo-sqlite';

import { getGenericGroupMembers } from '@/infrastructure/medications/medication-reference';

import { isGenericEquivalenceConfirmed } from './generic-equivalence-repository';
import { listTreatments } from './treatment-repository';

export type GenericEquivalenceCandidate = Readonly<{
  treatmentId: number;
  treatmentName: string;
  groupLabel: string;
}>;

/**
 * Traitements actifs pour lesquels ce CIS — différent du leur — appartient
 * au même groupe générique officiel (BDPM) et n'a encore jamais été
 * confirmé comme équivalence mémorisée pour ce couple (traitement, CIS)
 * précis (ticket 24). Sert à la fois à la désignation d'une boîte pendant
 * une préparation et à son ajout au stock : jamais de déduction par groupe,
 * uniquement les couples qu'il reste à confirmer explicitement.
 */
export async function findGenericEquivalenceCandidates(
  personalDatabase: SQLiteDatabase,
  referenceDatabase: SQLiteDatabase,
  cis: string,
): Promise<GenericEquivalenceCandidate[]> {
  const treatments = await listTreatments(personalDatabase);
  const otherActiveTreatments = treatments.filter(
    (treatment) =>
      treatment.archivedAt === null && treatment.specialtyCis !== cis,
  );
  if (otherActiveTreatments.length === 0) return [];

  const members = await getGenericGroupMembers(referenceDatabase, cis);
  if (members.length === 0) return [];
  const groupLabelByCis = new Map(
    members.map((member) => [member.cis, member.groupLabel]),
  );

  const candidates: GenericEquivalenceCandidate[] = [];
  for (const treatment of otherActiveTreatments) {
    const groupLabel = groupLabelByCis.get(treatment.specialtyCis);
    if (groupLabel === undefined) continue;
    const alreadyConfirmed = await isGenericEquivalenceConfirmed(
      personalDatabase,
      treatment.id,
      cis,
    );
    if (alreadyConfirmed) continue;
    candidates.push({
      treatmentId: treatment.id,
      treatmentName: treatment.specialtyName,
      groupLabel,
    });
  }
  return candidates;
}
