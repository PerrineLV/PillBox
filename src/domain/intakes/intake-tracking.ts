import type { GeneratedIntake } from '@/domain/treatments/generate-intakes';
import type { IntakeSlot } from '@/domain/treatments/treatment';

export const INTAKE_STATUSES = ['UNSET', 'TAKEN', 'SKIPPED'] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

export type IntakeRecord = Readonly<{
  key: string;
  treatmentId: number;
  date: string;
  slot: IntakeSlot;
  specialtyCis: string;
  specialtyName: string;
  pharmaceuticalForm: string | null;
  quantityHalfUnits: number;
  status: IntakeStatus;
  createdAt: string;
  updatedAt: string;
}>;

export type IntakeGroupKey = Readonly<{ date: string; slot: IntakeSlot }>;

export function intakeRecordKey(
  treatmentId: number,
  date: string,
  slot: IntakeSlot,
): string {
  if (!Number.isSafeInteger(treatmentId) || treatmentId <= 0)
    throw new Error('Traitement invalide.');
  assertCivilDate(date);
  return `${treatmentId}:${date}:${slot}`;
}

export function snapshotGeneratedIntake(
  intake: GeneratedIntake,
  pharmaceuticalForm: string | null,
): Omit<IntakeRecord, 'status' | 'createdAt' | 'updatedAt'> {
  return {
    key: intakeRecordKey(intake.treatmentId, intake.date, intake.slot),
    treatmentId: intake.treatmentId,
    date: intake.date,
    slot: intake.slot,
    specialtyCis: intake.specialtyCis,
    specialtyName: intake.specialtyName,
    pharmaceuticalForm,
    quantityHalfUnits: intake.quantityHalfUnits,
  };
}

export function isIntakeStatus(value: string): value is IntakeStatus {
  return INTAKE_STATUSES.some((status) => status === value);
}

function assertCivilDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Date invalide.');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new Error('Date invalide.');
}
