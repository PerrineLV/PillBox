import type { SQLiteDatabase } from 'expo-sqlite';

import { listMedicationBoxes } from '@/infrastructure/inventory/inventory-repository';
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

export type GenericEquivalenceBoxCandidate = Readonly<{
  specialtyCis: string;
  specialtyName: string;
  groupLabel: string;
}>;

/**
 * Symétrique de `findGenericEquivalenceCandidates`, vu depuis le traitement
 * plutôt que depuis la boîte : boîtes du stock dont le CIS — différent de
 * celui de ce traitement — appartient au même groupe générique officiel
 * (BDPM) et n'a encore jamais été confirmé pour ce couple (traitement, CIS)
 * précis. Sert au moment de la création d'un traitement (ticket 29), où une
 * boîte a pu être ajoutée au stock avant que le traitement n'existe : elle
 * n'a alors jamais eu l'occasion d'être proposée à la confirmation. Une
 * boîte par CIS distinct suffit, même si plusieurs boîtes du stock partagent
 * ce CIS.
 */
export async function findGenericEquivalenceBoxCandidates(
  personalDatabase: SQLiteDatabase,
  referenceDatabase: SQLiteDatabase,
  treatmentId: number,
  treatmentCis: string,
): Promise<GenericEquivalenceBoxCandidate[]> {
  const members = await getGenericGroupMembers(referenceDatabase, treatmentCis);
  if (members.length === 0) return [];
  const groupLabelByCis = new Map(
    members.map((member) => [member.cis, member.groupLabel]),
  );

  const boxes = await listMedicationBoxes(personalDatabase);
  const seenCis = new Set<string>();
  const candidates: GenericEquivalenceBoxCandidate[] = [];
  for (const box of boxes) {
    if (box.specialtyCis === treatmentCis) continue;
    if (seenCis.has(box.specialtyCis)) continue;
    const groupLabel = groupLabelByCis.get(box.specialtyCis);
    if (groupLabel === undefined) continue;
    const alreadyConfirmed = await isGenericEquivalenceConfirmed(
      personalDatabase,
      treatmentId,
      box.specialtyCis,
    );
    if (alreadyConfirmed) continue;
    seenCis.add(box.specialtyCis);
    candidates.push({
      specialtyCis: box.specialtyCis,
      specialtyName: box.specialtyName,
      groupLabel,
    });
  }
  return candidates;
}
