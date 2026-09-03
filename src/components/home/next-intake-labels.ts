import type { TodaySlotEntry } from '@/domain/home/today-plan';
import type { SlotTime } from '@/domain/reminders/intake-reminder';
import { INTAKE_SLOT_LABELS } from '@/ui';

export function formatSlotTime(time: SlotTime): string {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

/** Écart lisible entre deux instants du jour : « 2 h 40 », « 35 min ». */
export function formatMinutesGap(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  if (hours === 0) return `${total} min`;
  const rest = total % 60;
  return rest === 0
    ? `${hours} h`
    : `${hours} h ${String(rest).padStart(2, '0')}`;
}

/**
 * Ligne de contexte au-dessus du titre. Une prise déjà due mais non
 * renseignée n'est jamais annoncée comme « prochaine » : elle attend.
 */
export function nextIntakeEyebrow(
  entry: TodaySlotEntry,
  nowMinutes: number,
): string {
  const gap = entry.minutesOfDay - nowMinutes;
  if (gap > 0) return `Prochaine prise · dans ${formatMinutesGap(gap)}`;
  if (entry.pendingCount > 0)
    return `En attente · depuis ${formatMinutesGap(-gap)}`;
  return 'Créneau terminé';
}

/** Décompte affiché à côté du titre du créneau. */
export function slotProgressLabel(entry: TodaySlotEntry): string {
  const total = entry.records.length;
  if (entry.pendingCount === total)
    return `${total} médicament${total > 1 ? 's' : ''}`;
  return `${entry.takenCount} sur ${total} validé${entry.takenCount > 1 ? 's' : ''}`;
}

/**
 * Confirmation affichée à la place du bouton une fois le créneau complet.
 * Une prise ignorée est renseignée, pas validée : le libellé le distingue.
 */
export function slotSettledLabel(entry: TodaySlotEntry): string | null {
  if (entry.settledAt === null) return null;
  const time = parseTimestamp(entry.settledAt).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const slot = INTAKE_SLOT_LABELS[entry.slot].toLowerCase();
  const allTaken = entry.takenCount === entry.records.length;
  return `✓ Créneau du ${slot} ${allTaken ? 'validé' : 'renseigné'} à ${time}`;
}

/**
 * SQLite écrit `CURRENT_TIMESTAMP` en UTC et sans fuseau
 * (« 2026-09-01 17:04:12 ») : sans le suffixe explicite, l'heure serait lue
 * comme locale et affichée avec le décalage en trop.
 */
function parseTimestamp(value: string): Date {
  return new Date(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
      ? `${value.replace(' ', 'T')}Z`
      : value,
  );
}
