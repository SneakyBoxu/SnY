export function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(',', '.').replace(/\s/g, '');
  if (cleaned === '' || cleaned === '.' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function round(n: number, decimals = 1): number {
  const p = Math.pow(10, decimals);
  return Math.round(n * p) / p;
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString();
}

export function fmtNum(n: number, decimals = 1): string {
  return round(n, decimals).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export function fmtSigned(n: number, decimals = 1): string {
  const v = round(n, decimals);
  return v > 0 ? `+${v}` : `${v}`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
