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
