import { getAdapters } from "@/server/adapters";
import type { RequestRow, StipendRow, UserRecord } from "@/server/adapters/types";
import { fiscalYearLabel, requestIdPrefix } from "@/lib/fiscal-year";
import { moneyPlain, parseMoney } from "@/lib/money";
import type { FundingKey } from "@/lib/request-schema";

/**
 * Stipends: the pots of PTA money a requester can say a reimbursement comes
 * out of. A teacher (role `teacher`) chooses, line by line, between their
 * classroom stipend, the shared stipend of each grade they teach (none, one,
 * or several for a combination class), the school-wide field-trip fund, or
 * none. Anyone else with their own stipend chooses it or none. Everyone else
 * is not asked.
 *
 * Amounts come from the Stipends tab (classroom, field trip, each grade) and
 * the user's own `stipend` cell. Use is added up from the request log for the
 * current fiscal year. Nothing is enforced: going over is shown, and AP
 * decides.
 */

export type StipendKey = Exclude<FundingKey, "none">;

/** One stipend the requester can draw on, and where it stands this fiscal year. */
export interface StipendStatus {
  /** The form's value for this choice: the key, or "grade:2" for a grade's stipend. */
  id: string;
  key: StipendKey;
  /** "Classroom stipend", "Grade 2 stipend", "Field trip", "Stipend" */
  label: string;
  /** Who else draws on it, e.g. "grade 2 teachers"; null when it's the requester's alone. */
  sharedWith: string | null;
  /** Null when no amount is set: the choice is still recorded, but there's nothing to count down. */
  amountCents: number | null;
  /** Claimed this fiscal year by everyone sharing it, except returned requests. */
  usedCents: number;
  /** The part of `usedCents` already paid. */
  paidCents: number;
  /** Negative when over; null without an amount. */
  remainingCents: number | null;
}

export interface FundingOptions {
  /** e.g. "FY27" */
  fiscalYear: string;
  /** Empty when the requester has no stipends; the form then asks nothing. */
  stipends: StipendStatus[];
}

export class FundingError extends Error {}

/**
 * Cents from an amount cell. Admins type these by hand ("500", "$1,000") and
 * the Sheet may hand back a bare number. Blank or unreadable means no amount.
 */
export function parseAmount(value: string | undefined): number | null {
  const cleaned = String(value ?? "").replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const dollars = Number(cleaned);
  return Number.isFinite(dollars) && dollars >= 0 ? Math.round(dollars * 100) : null;
}

/** The grades a teacher can be assigned, youngest first. TK is transitional kindergarten. */
export const GRADES = ["TK", "K", "1", "2", "3", "4", "5"];

/** "2nd" → "2", "k" → "K", "Kindergarten" → "K", "T-K" or "Transitional Kindergarten" → "TK", "Grade 3" → "3". */
export function normalizeGrade(value: string | undefined): string {
  const grade = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[-.]/g, "")
    .replace(/^GRADE\s*/, "")
    .replace(/^(\d+)(ST|ND|RD|TH)$/, "$1")
    .trim();
  const kinder = grade.match(/^(TRANSITIONAL\s+)?KINDERGAR[TD]EN$/);
  if (kinder) return kinder[1] ? "TK" : "K";
  return grade;
}

/**
 * The grades in a teacher's `grade` cell, which lists several for a
 * combination class: "1, 2", "TK & K", "K/1", "Grade 1 and Grade 2". Commas
 * are safest: the Sheet turns "1/2" into a date.
 */
export function parseGrades(value: string | undefined): string[] {
  const parts = String(value ?? "").split(/\s*(?:[,;&+/]|\band\b)\s*/i);
  return [...new Set(parts.map(normalizeGrade).filter(Boolean))];
}

/** "Transitional kindergarten", "Kindergarten", "Grade 2". */
export function gradeName(grade: string): string {
  if (grade === "TK") return "Transitional kindergarten";
  if (grade === "K") return "Kindergarten";
  return `Grade ${grade}`;
}

/**
 * Reads a request's `funding` cell or a Stipends-tab `name`. Both may be typed
 * by hand, so this goes by the leading word: "Classroom…", "Field trip…",
 * "…grade…" or "Stipend"; anything else, blank included, is none.
 */
export function parseFunding(text: string | undefined): { key: FundingKey; grade: string } {
  const t = String(text ?? "").trim().toLowerCase();
  if (t.startsWith("classroom")) return { key: "classroom", grade: "" };
  if (t.startsWith("field")) return { key: "field_trip", grade: "" };
  if (t.includes("grade")) return { key: "grade", grade: normalizeGrade(t.replace(/grade|level|stipend|-/g, "")) };
  if (t.startsWith("stipend")) return { key: "stipend", grade: "" };
  return { key: "none", grade: "" };
}

/** The form's value for a choice: the key, or "grade:2" for a grade's stipend. */
export function fundingChoice(key: FundingKey, grade: string): string {
  return key === "grade" ? `grade:${grade}` : key;
}

/** Back from a form value (already checked against FUNDING_CHOICE) to key and grade. */
export function parseFundingChoice(choice: string): { key: FundingKey; grade: string } {
  const [key, grade = ""] = choice.split(":");
  return { key: key as FundingKey, grade };
}

/** The readable name of a choice: what the `funding` cell and the emails say. */
export function fundingLabel(key: FundingKey, grade: string): string {
  switch (key) {
    case "classroom":
      return "Classroom stipend";
    case "grade":
      return `Grade ${grade} stipend`;
    case "field_trip":
      return "Field trip";
    case "stipend":
      return "Stipend";
    case "none":
      return "Not from a stipend";
  }
}

/** One stipend's part of a request, as read from or written to the `funding` cell. */
export interface FundingPortion {
  key: FundingKey;
  grade: string;
  cents: number;
}

/**
 * What goes in the request's `funding` cell. A request charged to one choice
 * gets its label alone ("Grade 2 stipend"), and its reimbursement claimed is
 * what counts. A request split between choices lists each with its amount:
 * "Classroom stipend: 40.00; Grade 2 stipend: 50.00".
 */
export function fundingCell(portions: FundingPortion[]): string {
  if (portions.length === 1) return fundingLabel(portions[0].key, portions[0].grade);
  return portions.map((p) => `${fundingLabel(p.key, p.grade)}: ${moneyPlain(p.cents)}`).join("; ");
}

/**
 * Reads a `funding` cell back, with the row's reimbursement claimed for a
 * single-choice cell. In a split cell, a part without an amount (AP may edit
 * by hand: "Classroom stipend: 40.00; Grade 2 stipend") takes whatever the
 * amounts don't account for; a second such part gets nothing.
 */
export function parseFundingCell(cell: string | undefined, claimed: string | undefined): FundingPortion[] {
  const claimedCents = parseMoney(claimed ?? "") ?? 0;
  const parts = String(cell ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [{ ...parseFunding(parts[0]), cents: claimedCents }];
  const read = parts.map((part) => {
    const match = part.match(/^(.*?)\s*:\s*\$?([\d,]+(?:\.\d+)?)$/);
    return { ...parseFunding(match ? match[1] : part), cents: match ? (parseAmount(match[2]) ?? 0) : null };
  });
  let rest = claimedCents - read.reduce((sum, p) => sum + (p.cents ?? 0), 0);
  return read.map((p) => {
    if (p.cents !== null) return { key: p.key, grade: p.grade, cents: p.cents };
    const cents = Math.max(0, rest);
    rest = 0;
    return { key: p.key, grade: p.grade, cents };
  });
}

/** The grades offered at approval: TK, K and 1–5, then any others the Stipends tab names. */
export function stipendGrades(rows: StipendRow[]): string[] {
  const named = rows.map((row) => parseFunding(row.name)).filter((f) => f.key === "grade" && f.grade).map((f) => f.grade);
  return [...new Set([...GRADES, ...named])];
}

function tabAmounts(rows: StipendRow[]) {
  const amounts = { classroom: null as number | null, fieldTrip: null as number | null, grades: new Map<string, number>() };
  for (const row of rows) {
    const cents = parseAmount(row.amount);
    if (cents === null) continue;
    const { key, grade } = parseFunding(row.name);
    if (key === "classroom") amounts.classroom = cents;
    else if (key === "field_trip") amounts.fieldTrip = cents;
    else if (key === "grade" && grade) amounts.grades.set(grade, cents);
  }
  return amounts;
}

type Pot = Omit<StipendStatus, "usedCents" | "paidCents" | "remainingCents"> & { grade: string };

/**
 * The stipends `user` can choose from and where each stands. `requests` is the
 * whole log: a grade's stipend and the field-trip fund are shared, so other
 * requesters' claims count too. A request counts toward the fiscal year in its
 * ID (the year it was first submitted).
 */
export function fundingOptions(
  user: Pick<UserRecord, "email" | "role" | "grade" | "stipend"> | null,
  stipendRows: StipendRow[],
  requests: RequestRow[],
  now: Date,
): FundingOptions {
  const fiscalYear = fiscalYearLabel(now);
  if (!user) return { fiscalYear, stipends: [] };
  const amounts = tabAmounts(stipendRows);
  const own = parseAmount(user.stipend);
  const gradePot = (grade: string): Pot => ({
    id: fundingChoice("grade", grade),
    key: "grade",
    label: fundingLabel("grade", grade),
    sharedWith: `grade ${grade} teachers`,
    amountCents: amounts.grades.get(grade) ?? null,
    grade,
  });
  const pots: Pot[] =
    user.role === "teacher"
      ? [
          // A teacher's own `stipend` overrides the standard classroom amount (a job share, say).
          { id: "classroom", key: "classroom", label: "Classroom stipend", sharedWith: null, amountCents: own ?? amounts.classroom, grade: "" },
          ...parseGrades(user.grade).map(gradePot),
          { id: "field_trip", key: "field_trip", label: "Field trip", sharedWith: "all teachers", amountCents: amounts.fieldTrip, grade: "" },
        ]
      : own !== null
        ? [{ id: "stipend", key: "stipend", label: "Stipend", sharedWith: null, amountCents: own, grade: "" }]
        : [];

  const prefix = requestIdPrefix(now);
  const email = user.email.trim().toLowerCase();
  const counted = requests.filter((row) => row.status !== "Returned" && row.request_id.startsWith(prefix));
  const portions = counted.map((row) => ({ row, portions: parseFundingCell(row.funding, row.reimbursement_claimed) }));
  const stipends = pots.map(({ grade: potGrade, ...pot }): StipendStatus => {
    let usedCents = 0;
    let paidCents = 0;
    for (const { row, portions: rowPortions } of portions) {
      if ((pot.key === "classroom" || pot.key === "stipend") && row.requester_email.trim().toLowerCase() !== email) continue;
      for (const portion of rowPortions) {
        if (portion.key !== pot.key) continue;
        if (pot.key === "grade" && portion.grade !== potGrade) continue;
        usedCents += portion.cents;
        if (row.status === "Paid") paidCents += portion.cents;
      }
    }
    return { ...pot, usedCents, paidCents, remainingCents: pot.amountCents === null ? null : pot.amountCents - usedCents };
  });
  return { fiscalYear, stipends };
}

/** `user`'s stipends this fiscal year; the caller has already loaded the Users row. */
export async function currentFunding(user: UserRecord | null): Promise<FundingOptions> {
  const { stipends, log } = await getAdapters();
  const [stipendRows, requests] = await Promise.all([stipends.list(), log.list()]);
  return fundingOptions(user, stipendRows, requests, new Date());
}
