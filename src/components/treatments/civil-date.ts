/** Convertit une date civile stockée en ISO vers son affichage français. */
export function formatFrenchCivilDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/** Affiche une date civile sans conversion UTC, par exemple « 9 août 2026 ». */
export function formatLongFrenchCivilDate(value: string): string {
  const date = civilDateToPickerDate(value);
  if (date === null) return value;
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/**
 * Affiche une période civile de façon compacte, par exemple « du 17 au 23 août ».
 * Le mois n'est répété que lorsque la période le traverse, et l'année seulement
 * lorsqu'elle change.
 */
export function formatFrenchCivilPeriod(start: string, end: string): string {
  const startDate = civilDateToPickerDate(start);
  const endDate = civilDateToPickerDate(end);
  if (startDate === null || endDate === null) return `du ${start} au ${end}`;
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const sameMonth = sameYear && startDate.getMonth() === endDate.getMonth();
  const startOptions: Intl.DateTimeFormatOptions = sameMonth
    ? { day: 'numeric' }
    : sameYear
      ? { day: 'numeric', month: 'long' }
      : { day: 'numeric', month: 'long', year: 'numeric' };
  const endOptions: Intl.DateTimeFormatOptions = sameYear
    ? { day: 'numeric', month: 'long' }
    : { day: 'numeric', month: 'long', year: 'numeric' };
  const startLabel = new Intl.DateTimeFormat('fr-FR', startOptions).format(
    startDate,
  );
  const endLabel = new Intl.DateTimeFormat('fr-FR', endOptions).format(endDate);
  return `du ${startLabel} au ${endLabel}`;
}

/** Ajoute le jour de la semaine pour les écrans centrés sur une prise. */
export function formatFullFrenchCivilDate(value: string): string {
  const date = civilDateToPickerDate(value);
  if (date === null) return value;
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'full',
  }).format(date);
}

/** Affiche un horodatage SQLite/ISO dans le fuseau local de l’appareil. */
export function formatFrenchDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Crée une date locale à midi pour éviter les changements de jour liés au fuseau. */
export function civilDateToPickerDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    12,
  );
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  )
    return null;
  return date;
}

/** Lendemain d’une date civile, ou `null` si la date est inexploitable. */
export function nextCivilDay(value: string): string | null {
  const date = civilDateToPickerDate(value);
  if (date === null) return null;
  date.setDate(date.getDate() + 1);
  return pickerDateToCivilDate(date);
}

/** Convertit le choix local du calendrier vers le format civil SQLite. */
export function pickerDateToCivilDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
