/** Ajoute (ou retranche) un nombre de jours civils à une date `YYYY-MM-DD`. */
export function addCivilDays(value: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Date invalide.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new Error('Date invalide.');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
