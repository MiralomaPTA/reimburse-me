const TZ = "America/Los_Angeles";

/** 10/14/2026 */
export function formatDateShort(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric" }).format(date);
}

/** Oct 14, 2026, 3:20 PM PT */
export function formatDateTime(date: Date): string {
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date) + " PT"
  );
}

/** The moment in a date cell, or null when it's blank or unreadable (a cell typed into the Sheet by hand, say). */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The calendar day "2026-11-20" names, or null when it isn't a real one ("2026-02-30", "11/20/2026"). */
export function parseDay(value: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.getUTCMonth() === Number(m[2]) - 1 && date.getUTCDate() === Number(m[3]) ? m[0] : null;
}

/** "Nov 20, 2026" for a calendar day "2026-11-20"; anything else (a date typed into the Sheet) as it is. */
export function formatDay(value: string | null | undefined): string {
  const day = parseDay(value);
  if (!day) return String(value ?? "");
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** When a calendar day "2026-11-20" begins in Pacific time (08:00 UTC, or 07:00 in daylight time), or null when it isn't one. */
export function dayStart(value: string | null | undefined): Date | null {
  const day = parseDay(value);
  if (!day) return null;
  const [y, m, d] = day.split("-").map(Number);
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" });
  for (const utcHour of [7, 8]) {
    const at = new Date(Date.UTC(y, m - 1, d, utcHour));
    if (formatIsoDate(at) === day && Number(hour.format(at)) === 0) return at;
  }
  return new Date(Date.UTC(y, m - 1, d, 8));
}

/** 2026-11-15, the date in Pacific time: for file names. */
export function formatIsoDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Nov 15 */
export function formatMonthDay(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" }).format(date);
}
