import type { AsNeededIntakeRecord } from '@/domain/intakes/as-needed-intake';
import type { IntakeRecord } from '@/domain/intakes/intake-tracking';
import { localCivilDate } from '@/domain/reminders/intake-reminder';

export const STATISTICS_GROUPINGS = ['week', 'month'] as const;
export type StatisticsGrouping = (typeof STATISTICS_GROUPINGS)[number];

/**
 * Comptage descriptif d'une période pour les prises planifiées : les trois
 * statuts sont mutuellement exclusifs et leur somme vaut toujours
 * `scheduledCount`. `unsetCount` ne signifie jamais que la prise n'a pas eu
 * lieu, seulement qu'aucun statut n'a été enregistré.
 */
export type IntakePeriodStatistics = Readonly<{
  periodKey: string;
  startDate: string;
  endDate: string;
  scheduledCount: number;
  takenCount: number;
  skippedCount: number;
  unsetCount: number;
}>;

/**
 * Comptage descriptif d'une période pour les prises « si besoin » : sans
 * calendrier attendu, il n'y a pas de notion de prise prévue ni de ratio.
 */
export type AsNeededPeriodStatistics = Readonly<{
  periodKey: string;
  startDate: string;
  endDate: string;
  recordedCount: number;
}>;

export function groupIntakesByPeriod(
  records: readonly IntakeRecord[],
  grouping: StatisticsGrouping,
): IntakePeriodStatistics[] {
  const buckets = new Map<string, Omit<IntakePeriodStatistics, 'periodKey'>>();
  for (const record of records) {
    const period = periodOf(record.date, grouping);
    const bucket = buckets.get(period.key) ?? {
      startDate: period.startDate,
      endDate: period.endDate,
      scheduledCount: 0,
      takenCount: 0,
      skippedCount: 0,
      unsetCount: 0,
    };
    buckets.set(period.key, {
      ...bucket,
      scheduledCount: bucket.scheduledCount + 1,
      takenCount: bucket.takenCount + (record.status === 'TAKEN' ? 1 : 0),
      skippedCount: bucket.skippedCount + (record.status === 'SKIPPED' ? 1 : 0),
      unsetCount: bucket.unsetCount + (record.status === 'UNSET' ? 1 : 0),
    });
  }
  return sortedPeriods(buckets);
}

export function groupAsNeededIntakesByPeriod(
  records: readonly AsNeededIntakeRecord[],
  grouping: StatisticsGrouping,
): AsNeededPeriodStatistics[] {
  const buckets = new Map<
    string,
    Omit<AsNeededPeriodStatistics, 'periodKey'>
  >();
  for (const record of records) {
    const civilDate = localCivilDate(new Date(record.takenAt));
    const period = periodOf(civilDate, grouping);
    const bucket = buckets.get(period.key) ?? {
      startDate: period.startDate,
      endDate: period.endDate,
      recordedCount: 0,
    };
    buckets.set(period.key, {
      ...bucket,
      recordedCount: bucket.recordedCount + 1,
    });
  }
  return sortedPeriods(buckets);
}

/**
 * Proportion de prises enregistrées comme prises, sur l'ensemble des prises
 * prévues de la période (le dénominateur est `scheduledCount`). `null`
 * lorsqu'aucune prise n'était prévue : il n'y a alors rien à proportionner.
 * Ce n'est ni un score d'observance ni d'adhérence, et une prise non
 * renseignée n'entre jamais au numérateur.
 */
export function recordedTakenRatio(
  stats: Pick<IntakePeriodStatistics, 'scheduledCount' | 'takenCount'>,
): number | null {
  if (stats.scheduledCount === 0) return null;
  return stats.takenCount / stats.scheduledCount;
}

function sortedPeriods<Stats extends { startDate: string; endDate: string }>(
  buckets: Map<string, Stats>,
): (Stats & { periodKey: string })[] {
  return [...buckets.entries()]
    .map(([periodKey, bucket]) => ({ periodKey, ...bucket }))
    .sort((a, b) =>
      a.periodKey < b.periodKey ? 1 : a.periodKey > b.periodKey ? -1 : 0,
    );
}

function periodOf(
  civilDate: string,
  grouping: StatisticsGrouping,
): { key: string; startDate: string; endDate: string } {
  const parsed = parseCivilDate(civilDate);
  if (grouping === 'month') {
    const start = new Date(parsed.getFullYear(), parsed.getMonth(), 1, 12);
    const end = new Date(parsed.getFullYear(), parsed.getMonth() + 1, 0, 12);
    const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
    return {
      key,
      startDate: localCivilDate(start),
      endDate: localCivilDate(end),
    };
  }
  const weekday = parsed.getDay();
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
  const start = new Date(parsed);
  start.setDate(parsed.getDate() + diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const key = localCivilDate(start);
  return { key, startDate: key, endDate: localCivilDate(end) };
}

function parseCivilDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) throw new Error('Date invalide.');
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}
