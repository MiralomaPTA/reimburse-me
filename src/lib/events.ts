import type { ChairStep, EventRow, RequestRow } from "@/server/adapters/types";
import { parseMoney } from "@/lib/money";

/**
 * PTA events and their chairs, shared by the form (to guess the event from
 * the description) and the server (to decide who signs the VP/Chairman line).
 */

export interface PtaEvent {
  /** As written in the Events tab, e.g. "Fun Run". */
  name: string;
  /** Lower-case chair addresses; every one is asked, any one may sign. */
  chairs: string[];
  /** Other words for the event, e.g. "jog-a-thon". */
  aliases: string[];
  /** This fiscal year's budget; null when the tab sets none. */
  budgetCents: number | null;
  active: boolean;
}

/** A comma-separated cell as a list; semicolons and line breaks also separate, since people paste them. */
function cellList(cell: string | undefined): string[] {
  return String(cell ?? "")
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const INACTIVE = new Set(["no", "n", "false", "0", "inactive"]);
const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

/** The longest event name the form accepts; the Events tab's longer ones are ignored, so the form never offers one it can't submit. */
export const EVENT_NAME_MAX = 200;

/** What the request form needs of an event. The budget stays on the server: requesters don't see it. */
export type FormEvent = Pick<PtaEvent, "name" | "aliases" | "chairs">;

export const toFormEvent = ({ name, aliases, chairs }: PtaEvent): FormEvent => ({ name, aliases, chairs });

/**
 * The Events tab as events. Blank `active` counts as active, so a row needs
 * only a name and a chair. Rows with the same name are read as one event
 * with all their chairs and aliases and the first budget given. When some of
 * those rows are active, the inactive ones are left out, so last year's row
 * kept beside this year's adds neither last year's chair nor its budget.
 */
export function parseEvents(rows: EventRow[]): PtaEvent[] {
  const groups: { name: string; rows: { chairs: string[]; aliases: string[]; budgetCents: number | null; active: boolean }[] }[] = [];
  for (const row of rows) {
    const name = String(row.name ?? "").trim().replace(/\s+/g, " ");
    if (!name || name.length > EVENT_NAME_MAX) continue;
    const parsed = {
      chairs: cellList(row.chair_email)
        .map((email) => email.toLowerCase())
        .filter((email) => email.includes("@")),
      aliases: cellList(row.aliases),
      // The Sheet may hand back a bare number; anything unreadable means no budget.
      budgetCents: parseMoney(String(row.budget ?? "")),
      active: !INACTIVE.has(String(row.active ?? "").trim().toLowerCase()),
    };
    const group = groups.find((g) => sameName(g.name, name));
    if (group) group.rows.push(parsed);
    else groups.push({ name, rows: [parsed] });
  }
  return groups.map(({ name, rows: all }) => {
    const active = all.some((r) => r.active);
    const used = active ? all.filter((r) => r.active) : all;
    return {
      name,
      chairs: [...new Set(used.flatMap((r) => r.chairs))],
      aliases: [...new Set(used.flatMap((r) => r.aliases))],
      budgetCents: used.find((r) => r.budgetCents !== null)?.budgetCents ?? null,
      active,
    };
  });
}

/** The event called `name` (ignoring case and spacing), or null. */
export function findEvent<E extends Pick<PtaEvent, "name">>(events: E[], name: string): E | null {
  return name.trim() ? (events.find((e) => sameName(e.name, name)) ?? null) : null;
}

/** Lower-case words of letters and digits; accents dropped. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Whether `text` names `term` as whole words, ignoring case, spaces, hyphens
 * and punctuation: "fun run", "Fun-Run" and "FunRun" all name "Fun Run", but
 * "party" does not name "Art".
 */
export function mentions(text: string, term: string): boolean {
  const target = words(term).join("");
  if (!target) return false;
  const textWords = words(text);
  for (let i = 0; i < textWords.length; i++) {
    let joined = "";
    for (let j = i; j < textWords.length && joined.length < target.length; j++) {
      joined += textWords[j];
      if (joined === target) return true;
    }
  }
  return false;
}

/** The events whose name or an alias appears in any of `texts` (the purpose and line descriptions), in the tab's order. */
export function guessEvents(texts: string[], events: Pick<PtaEvent, "name" | "aliases">[]): string[] {
  return events.filter((event) => [event.name, ...event.aliases].some((term) => texts.some((text) => mentions(text, term)))).map((event) => event.name);
}

export interface ChairRouting {
  step: ChairStep;
  /** Who is asked to sign; empty unless `step` is "Waiting". */
  chairs: string[];
}

/**
 * Who signs the VP/Chairman line. Not for an event: nobody, as before the
 * chair step existed. A chair of the event who requests money for it is never
 * asked to sign their own request, and neither are their co-chairs: the line
 * stays blank for AP.
 */
export function chairRouting(event: Pick<PtaEvent, "chairs"> | null, requesterEmail: string): ChairRouting {
  if (!event) return { step: "", chairs: [] };
  if (event.chairs.includes(requesterEmail.trim().toLowerCase())) return { step: "Skipped: requester is a chair", chairs: [] };
  if (event.chairs.length === 0) return { step: "Skipped: no chair listed", chairs: [] };
  return { step: "Waiting", chairs: event.chairs };
}

/** Where an event's budget stands around one request. */
export interface EventBudget {
  budgetCents: number;
  /** Claimed by the event's other requests this fiscal year, returned ones left out. */
  usedBeforeCents: number;
  /** This request's reimbursement claimed. */
  thisCents: number;
  /** Negative when over. */
  leftBeforeCents: number;
  leftAfterCents: number;
}

/**
 * The event's budget before and after one request, or null when the event
 * has no budget. Counts the reimbursement claimed on every other request for
 * the event in the same fiscal year (by request ID, as stipends do), paid or
 * not, except returned ones. A warning, never a block: AP decides.
 */
export function eventBudget(
  event: Pick<PtaEvent, "name" | "budgetCents">,
  rows: Pick<RequestRow, "request_id" | "status" | "event" | "reimbursement_claimed">[],
  request: { requestId: string; claimedCents: number },
): EventBudget | null {
  if (event.budgetCents === null) return null;
  const prefix = request.requestId.slice(0, request.requestId.indexOf("-") + 1);
  const usedBeforeCents = rows
    .filter((row) => row.request_id !== request.requestId && row.status !== "Returned" && row.request_id.startsWith(prefix) && sameName(String(row.event ?? ""), event.name))
    .reduce((sum, row) => sum + (parseMoney(String(row.reimbursement_claimed ?? "")) ?? 0), 0);
  const leftBeforeCents = event.budgetCents - usedBeforeCents;
  return { budgetCents: event.budgetCents, usedBeforeCents, thisCents: request.claimedCents, leftBeforeCents, leftAfterCents: leftBeforeCents - request.claimedCents };
}

/** Printed beside the form's VP/Chairman line. */
export const eventLabel = (event: string) => `Event: ${event}`;
