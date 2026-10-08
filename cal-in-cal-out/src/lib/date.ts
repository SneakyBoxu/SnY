export function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return toLocalISODate(new Date());
}

export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, days: number): string {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + days);
  return toLocalISODate(d);
}

export function daysBetween(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  let cur = fromISO;
  let guard = 0;
  while (cur <= toISO && guard < 4000) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard++;
  }
  return out;
}

export function diffDays(aISO: string, bISO: string): number {
  const a = fromISODate(aISO).getTime();
  const b = fromISODate(bISO).getTime();
  return Math.round((b - a) / 86400000);
}

export function isoCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function formatDayLabel(iso: string): string {
  const d = fromISODate(iso);
  const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
  const rest = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const today = todayISO();
  if (iso === today) return `Today · ${rest}`;
  if (iso === addDays(today, -1)) return `Yesterday · ${rest}`;
  if (iso === addDays(today, -2)) return `2 days ago · ${rest}`;
  return `${weekday}, ${rest}`;
}

export function formatShortDate(iso: string): string {
  return fromISODate(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function getMondayOfWeek(iso: string): string {
  const d = fromISODate(iso);
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = (day + 6) % 7; // 0 for Monday, 6 for Sunday
  d.setDate(d.getDate() - diff);
  return toLocalISODate(d);
}
