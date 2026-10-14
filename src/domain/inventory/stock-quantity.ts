/** Le stock utilise des demi-unités exactes, comme les préparations. */
export function assertStockQuantity(quantity: number): void {
  if (quantity < 0 || !Number.isSafeInteger(quantity * 2)) {
    throw new Error(
      'Saisissez une quantité positive ou nulle, entière ou par demi-unité, sans dépasser 4 503 599 627 370 495,5.',
    );
  }
}

export function parseStockQuantity(text: string): number {
  if (!/^\d+(?:[.,](?:0+|50*))?$/.test(text.trim())) {
    throw new Error('Saisissez une quantité : 0, 90 ou 2,5 par exemple.');
  }
  const quantity = Number(text.trim().replace(',', '.'));
  assertStockQuantity(quantity);
  return quantity;
}
