import type { CategoryRow, RequestRow, RequestStatus } from "@/server/adapters/types";
import { returnedAtOf } from "@/server/requests/resubmit";
import { parseDate } from "@/lib/dates";
import { squash } from "@/lib/mailing";

/**
 * The AP dashboard's view of the request log (Phase 2a): who may see it, how
 * old each request is, the filters, and the budget category choices. Pure, so
 * the pages, the CSV export and the tests share it.
 */

export { isAp } from "@/server/auth/roles";

export const STATUSES: RequestStatus[] = ["Awaiting chair", "Awaiting signers", "Submitted", "Approved", "Returned", "Paid"];

/** Still with the event chair or the check signers, so not with AP yet. */
const BEFORE_AP: string[] = ["Awaiting chair", "Awaiting signers"];

const DAY_MS = 24 * 60 * 60 * 1000;

const latest = (cells: string[]): Date | null =>
  cells
    .map(parseDate)
    .filter((d): d is Date => d !== null)
    .reduce<Date | null>((max, d) => (!max || d > max ? d : max), null);

/**
 * When the request reached AP: when the requester signed, or once its event
 * chair and its check signers had signed, when it had them. Every later step's
 * cells start blank on a new version, so the latest of them is this version's.
 */
export function reachedApAt(row: RequestRow): Date | null {
  return latest([row.submitted_at, row.chair_signed_at, row.signer_2_signed_at, row.authorized_sent_at]);
}

/**
 * What a request's age counts from: reaching AP for Submitted and Approved,
 * the return for Returned, and the last email to the chair or the check
 * signers while it waits for them. Paid has none. A status typed into the
 * Sheet that the app doesn't know counts from reaching AP.
 */
export function ageFrom(row: RequestRow): Date | null {
  switch (row.status) {
    case "Paid":
      return null;
    case "Returned":
      return parseDate(returnedAtOf(row));
    case "Awaiting chair":
      return parseDate(row.chair_sent_at) ?? parseDate(row.submitted_at);
    case "Awaiting signers":
      return parseDate(row.signers_sent_at) ?? latest([row.submitted_at, row.chair_signed_at]);
    default:
      return reachedApAt(row);
  }
}

/** Whole days since `ageFrom`, or null when there's nothing to count from. */
export function ageDays(row: RequestRow, now: Date): number | null {
  const from = ageFrom(row);
  return from ? Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY_MS)) : null;
}

export function formatAge(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * The list's filters, from the page's query string. `status` is "" for the
 * default view (everything with AP, not Paid unless `paid`), "all", or one
 * status. `fy` is "FY27" or "" for every year. `q` searches the name, email,
 * purpose and request ID.
 */
export interface DashboardFilters {
  status: string;
  fy: string;
  q: string;
  paid: boolean;
}

type Query = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export function parseFilters(query: Query): DashboardFilters {
  const status = one(query.status);
  const fy = one(query.fy).toUpperCase();
  return {
    status: status === "all" || STATUSES.includes(status as RequestStatus) ? status : "",
    fy: /^FY\d{2}$/.test(fy) ? fy : "",
    q: one(query.q).trim().slice(0, 100),
    paid: one(query.paid) === "1",
  };
}

/** The filters as a query string, without the defaults: for the export link. */
export function filtersQuery(filters: DashboardFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.fy) params.set("fy", filters.fy);
  if (filters.q) params.set("q", filters.q);
  if (filters.paid) params.set("paid", "1");
  return params.toString();
}

export function matches(row: RequestRow, filters: DashboardFilters): boolean {
  if (filters.status === "") {
    if (BEFORE_AP.includes(row.status)) return false;
    if (row.status === "Paid" && !filters.paid) return false;
  } else if (filters.status !== "all" && row.status !== filters.status) return false;
  if (filters.fy && !row.request_id.toUpperCase().startsWith(`${filters.fy}-`)) return false;
  if (filters.q) {
    const q = filters.q.toLowerCase();
    if (![row.payee_name, row.requester_email, row.purpose, row.request_id].some((cell) => String(cell ?? "").toLowerCase().includes(q))) return false;
  }
  return true;
}

/** Oldest first: the longest wait at the top. Those with no age (Paid) go last, in the order they were signed. */
export function oldestFirst(rows: RequestRow[]): RequestRow[] {
  const key = (row: RequestRow) => ageFrom(row)?.getTime() ?? null;
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== null && kb !== null) return ka - kb;
    if (ka !== null) return -1;
    if (kb !== null) return 1;
    return String(a.submitted_at).localeCompare(String(b.submitted_at));
  });
}

/** The requester-signed packets of the earlier versions, oldest first: version 1's is first. Drive IDs are case-sensitive, so kept as written. */
export function earlierPackets(row: Pick<RequestRow, "previous_pdf_file_ids">): string[] {
  return String(row.previous_pdf_file_ids ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/** The fiscal years the request IDs name, newest first: the year filter's choices. */
export function fiscalYears(rows: RequestRow[]): string[] {
  const years = new Set<string>();
  for (const row of rows) {
    const year = /^FY\d{2}(?=-)/i.exec(row.request_id)?.[0];
    if (year) years.add(year.toUpperCase());
  }
  return [...years].sort().reverse();
}

/** Offered while the Categories tab has no rows yet. */
export const UNCATEGORIZED = "Uncategorized";

export interface CategoryChoices {
  /** The dropdown's names, in order: the active categories, then the request's own if it isn't one of them (an inactive one, say). */
  options: string[];
  /** Where the dropdown starts: the request's category, else the one its FO10's Budget Account names, else none. */
  selected: string;
  /** Whether `selected` comes from the FO10's Budget Account rather than a category already saved. */
  suggested: boolean;
}

/** The active categories by `order`, smallest first; a blank or unreadable order goes last, in the tab's order. */
export function activeCategories(rows: CategoryRow[]): string[] {
  const rank = (row: CategoryRow) => {
    const n = Number(String(row.order ?? "").trim());
    return String(row.order ?? "").trim() !== "" && Number.isFinite(n) ? n : Infinity;
  };
  const active = rows.filter((row) => String(row.name ?? "").trim() && String(row.active ?? "").trim().toLowerCase() !== "no");
  const names = active
    .map((row, i) => ({ name: String(row.name).trim(), rank: rank(row), i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((c) => c.name);
  return [...new Set(names)];
}

export function categoryChoices(rows: CategoryRow[], row: Pick<RequestRow, "budget_category" | "budget_account">): CategoryChoices {
  const hasRows = rows.some((r) => String(r.name ?? "").trim());
  const options = hasRows ? activeCategories(rows) : [UNCATEGORIZED];
  const current = String(row.budget_category ?? "").trim();
  if (current && !options.includes(current)) options.push(current);
  if (current) return { options, selected: current, suggested: false };
  const account = squash(row.budget_account);
  const match = account ? options.find((name) => squash(name) === account) : undefined;
  return { options, selected: match ?? "", suggested: Boolean(match) };
}
