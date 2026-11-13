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
