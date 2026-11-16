/**
 * Aritmética segura em centavos inteiros para exibição de prévias financeiras.
 * Os cálculos oficiais permanecem no banco (views e funções SQL).
 */
export function toCents(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const num = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function addMoney(a: number | string, b: number | string): number {
  return fromCents(toCents(a) + toCents(b));
}

export function subtractMoney(a: number | string, b: number | string): number {
  return fromCents(toCents(a) - toCents(b));
}

export function calculateMarginRatio(salePrice: number | string, totalCost: number | string): number {
  const saleCents = toCents(salePrice);
  if (saleCents <= 0) return 0;
  const profitCents = saleCents - toCents(totalCost);
  return profitCents / saleCents;
}
