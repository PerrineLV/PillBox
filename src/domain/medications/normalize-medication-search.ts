export function normalizeMedicationSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .trim()
    .replace(/\s+/g, ' ');
}

export function buildMedicationFtsQuery(value: string): string | null {
  const normalized = normalizeMedicationSearch(value);
  if (normalized.length === 0) return null;
  return normalized
    .split(' ')
    .map((token) => `${token}*`)
    .join(' AND ');
}
