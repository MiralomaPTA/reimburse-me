/** The PTA fiscal year runs July 1 to June 30 and is named for the year it ends in. */

export function fiscalYearLabel(date: Date, timeZone = "America/Los_Angeles"): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric" }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const endYear = month >= 7 ? year + 1 : year;
  return `FY${String(endYear % 100).padStart(2, "0")}`;
}

export function requestIdPrefix(date: Date): string {
  return `${fiscalYearLabel(date)}-`;
}

export function formatRequestId(prefix: string, sequence: number): string {
  return `${prefix}${String(sequence).padStart(3, "0")}`;
}
