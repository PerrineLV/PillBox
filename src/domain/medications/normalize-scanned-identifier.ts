/**
 * Normalisation volontairement limitée au cas observé sur trois boîtes réelles :
 * un CIP13 encodé dans l'AI 01 comme GTIN-14 avec un indicateur initial égal à 0.
 */
export function normalizeScannedGtinToCip13(gtin: string): string | null {
  if (!/^0\d{13}$/.test(gtin) || !hasValidGtinCheckDigit(gtin)) {
    return null;
  }

  return gtin.slice(1);
}

function hasValidGtinCheckDigit(value: string): boolean {
  const digits = [...value].map(Number);
  const suppliedCheckDigit = digits.pop();
  if (suppliedCheckDigit === undefined) return false;

  const sum = digits.reduce((total, digit, index) => {
    const distanceFromRight = digits.length - index;
    return total + digit * (distanceFromRight % 2 === 1 ? 3 : 1);
  }, 0);
  const expectedCheckDigit = (10 - (sum % 10)) % 10;
  return suppliedCheckDigit === expectedCheckDigit;
}
