import type { IntakeRecord } from '@/domain/intakes/intake-tracking';
import type {
  IntakeSlotTimes,
  SlotTime,
} from '@/domain/reminders/intake-reminder';
import { INTAKE_SLOTS, type IntakeSlot } from '@/domain/treatments/treatment';

/**
 * Un créneau réellement servi aujourd'hui, avec son avancement. Un créneau
 * sans aucune prise prévue n'existe pas : l'accueil ne montre jamais une
 * ligne vide « Coucher » parce que le modèle en connaît quatre.
 */
export type TodaySlotEntry = Readonly<{
  slot: IntakeSlot;
  time: SlotTime;
  minutesOfDay: number;
  records: readonly IntakeRecord[];
  pendingCount: number;
  /** Prises marquées comme prises ; les prises ignorées restent renseignées. */
  takenCount: number;
  /**
   * Horodatage de la dernière décision, lorsque plus aucune prise n'est en
   * attente. `null` tant que le créneau est incomplet : aucune heure de
   * validation ne doit être affichée pour un créneau encore ouvert.
   */
  settledAt: string | null;
}>;

export function minutesOfDay(time: SlotTime): number {
  return time.hour * 60 + time.minute;
}

/** Créneaux du jour, dans l'ordre des heures de rappel configurées. */
export function buildTodaySlots(
  records: readonly IntakeRecord[],
  slotTimes: IntakeSlotTimes,
): TodaySlotEntry[] {
  return INTAKE_SLOTS.map((slot) => {
    const slotRecords = records.filter((record) => record.slot === slot);
    const pendingCount = slotRecords.filter(
      (record) => record.status === 'UNSET',
    ).length;
    return {
      slot,
      time: slotTimes[slot],
      minutesOfDay: minutesOfDay(slotTimes[slot]),
      records: slotRecords,
      pendingCount,
      takenCount: slotRecords.filter((record) => record.status === 'TAKEN')
        .length,
      settledAt:
        slotRecords.length > 0 && pendingCount === 0
          ? slotRecords.reduce(
              (latest, record) =>
                record.updatedAt > latest ? record.updatedAt : latest,
              slotRecords[0].updatedAt,
            )
          : null,
    };
  })
    .filter((entry) => entry.records.length > 0)
    .sort((left, right) => left.minutesOfDay - right.minutesOfDay);
}

/**
 * Créneau porté par l'en-tête de l'accueil. Une prise déjà due mais non
 * renseignée passe avant une prise à venir : c'est elle que l'utilisatrice a
 * en main. Sans rien en attente, l'accueil montre la prochaine prise, puis, la
 * journée finie, le dernier créneau et son heure de validation.
 */
export function focusTodaySlot(
  entries: readonly TodaySlotEntry[],
  nowMinutes: number,
): TodaySlotEntry | null {
  if (entries.length === 0) return null;
  const due = entries.find(
    (entry) => entry.minutesOfDay <= nowMinutes && entry.pendingCount > 0,
  );
  if (due) return due;
  const upcoming = entries.find((entry) => entry.minutesOfDay > nowMinutes);
  return upcoming ?? entries[entries.length - 1];
}
