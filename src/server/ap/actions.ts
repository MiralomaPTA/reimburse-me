import type { Adapters, RequestRow, RequestStatus } from "@/server/adapters/types";
import { paidByBillPay } from "@/server/ap/mailed";
import { config } from "@/server/config";
import { apReturnedEmail, paidEmail, type PaidHow } from "@/server/email/templates";
import { BusyError, withRequestLock } from "@/server/requests/lock";
import { appendNotes, lowerEmail, versionOf } from "@/server/requests/rows";
import { loadCheckedRequest } from "@/server/requests/signers";
import { formatDay, formatIsoDate, parseDate, parseDay } from "@/lib/dates";
import { formatAddress, oneLine } from "@/lib/mailing";
import { parseMoney } from "@/lib/money";
import { totals } from "@/lib/request-schema";

/**
 * AP's steps on a request (Phase 2b): approve it, return it with a note,
 * record the check (or, for a mailed check, the bill pay payment), and mark it
 * sent. Each runs under the row's lock, the one chair and check signer steps
 * take, and checks the request's status and who's acting with the lock held,
 * so two AP members (or AP and a chair) can't both act at once. Every step
 * adds a row to the Actions tab. Returning and paying email the requester.
 * Nobody may act on their own request.
 */

export type ApAction = "approve" | "return" | "record" | "sent";

/** Why a step was refused, as a code the page words: nothing in the URL is shown as it is. */
export type ApProblem =
  | "not-found"
  | "own"
  | "status"
  | "busy"
  | "note"
  | "cancel"
  | "category"
  | "check-number"
  | "date"
  | "future"
  | "before-signed"
  | "before-check";

export class ApActionError extends Error {
  constructor(readonly problem: ApProblem) {
    super(problem);
  }
}

/** The statuses each step starts from. Paid is final: fixing one is a Sheet edit. */
export const ACTION_FROM: Record<ApAction, RequestStatus[]> = {
  approve: ["Submitted"],
  return: ["Submitted", "Approved", "Check written"],
  record: ["Submitted", "Approved"],
  sent: ["Check written"],
};

export const NOTE_MAX = 1000;
export const CHECK_NUMBER_MAX = 40;

export const isOwnRequest = (row: Pick<RequestRow, "requester_email">, email: string) => lowerEmail(row.requester_email) === lowerEmail(email);

export { paidByBillPay };

export function paidHow(row: RequestRow): PaidHow {
  if (row.check_delivery === "mail") return paidByBillPay(row) ? "bill pay" : "mailed";
  return row.check_delivery === "pickup" ? "pickup" : "mailbox";
}

/** The steps `email` can take on `row` now: none on their own request. */
export function availableActions(row: RequestRow, email: string): ApAction[] {
  if (isOwnRequest(row, email)) return [];
  return (Object.keys(ACTION_FROM) as ApAction[]).filter((action) => ACTION_FROM[action].includes(row.status));
}

interface StepInput {
  requestId: string;
  /** The signed-in AP member's address. */
  by: string;
  now?: Date;
}

/** What a step did: `emailed` is null when the step sends no email, false when its email failed (noted on the row). */
export interface StepResult {
  row: RequestRow;
  emailed: boolean | null;
}

type ActionNote = { action: string; note: string };

/**
 * The shared part of every step: under the lock, refuse your own request and
 * a status the step can't start from, then let `step` check the rest and
 * return the row's changes and the Actions records.
 */
async function act(
  adapters: Pick<Adapters, "log" | "actions">,
  input: StepInput,
  action: ApAction,
  step: (row: RequestRow) => { patch: Partial<RequestRow>; records: ActionNote[] },
): Promise<{ before: RequestRow; after: RequestRow }> {
  const { log, actions } = adapters;
  const found = await log.get(input.requestId);
  if (!found) throw new ApActionError("not-found");
  if (isOwnRequest(found, input.by)) throw new ApActionError("own");
  if (!ACTION_FROM[action].includes(found.status)) throw new ApActionError("status");
  const at = (input.now ?? new Date()).toISOString();
  const { before, patch, records } = await withRequestLock(log, found.request_id, async (current) => {
    // Checked again with the lock held: another AP member may have acted since the page loaded.
    if (isOwnRequest(current, input.by)) throw new ApActionError("own");
    if (!ACTION_FROM[action].includes(current.status)) throw new ApActionError("status");
    const done = step(current);
    return { patch: done.patch, result: { before: current, patch: done.patch, records: done.records } };
  }).catch((error: unknown) => {
    if (error instanceof BusyError) throw new ApActionError("busy");
    throw error;
  });
  for (const record of records) {
    try {
      await actions.append({ request_id: before.request_id, action: record.action, by: lowerEmail(input.by), at, note: record.note });
    } catch (error) {
      // The step is done; only its line in the history is missing.
      console.error(`[ap ${action}] ${before.request_id} is done, but the Actions tab didn't take "${record.action}: ${record.note}":`, error);
      // A voided check's number is on no other record once the return clears it from the row, so it goes in the row's notes instead.
      if (record.action === "void") await appendNotes(log, before.request_id, [`Voided ${record.note} (by ${lowerEmail(input.by)})`]);
    }
  }
  return { before, after: { ...before, ...patch, lock: "" } };
}

/** "check #1043, dated Nov 20, 2026", or for bill pay "bill pay confirmation 4821, set up Nov 20, 2026". */
function paymentNote(row: RequestRow, number: string, day: string): string {
  return paidByBillPay(row) ? `bill pay confirmation ${number}, set up ${formatDay(day)}` : `check #${number}, dated ${formatDay(day)}`;
}

/** A day from a date field: a real calendar day, and not after today in Pacific time. */
function checkedDay(value: string, now: Date): string {
  const day = parseDay(value);
  if (!day) throw new ApActionError("date");
  if (day > formatIsoDate(now)) throw new ApActionError("future");
  return day;
}

export async function approveRequest(input: StepInput, adapters: Pick<Adapters, "log" | "actions">): Promise<StepResult> {
  const now = input.now ?? new Date();
  const { after } = await act(adapters, { ...input, now }, "approve", () => ({
    patch: { status: "Approved", approved_at: now.toISOString(), approved_by: lowerEmail(input.by) },
    records: [{ action: "approve", note: "" }],
  }));
  return { row: after, emailed: null };
}

/**
 * Returns the request with a note. A check written for it is voided: its
 * number leaves the row and stays in the Actions tab. The requester gets the
 * note and a link to fix it, with AP copied; the new version goes back
 * through the chair and the check signers when this one did.
 */
export async function returnRequest(input: StepInput & { note: string; linkBase: string; cancelledAtBank?: boolean }, adapters: Adapters): Promise<StepResult> {
  const note = input.note.trim();
  if (!note || note.length > NOTE_MAX) throw new ApActionError("note");
  const now = input.now ?? new Date();
  const { before, after } = await act(adapters, { ...input, now }, "return", (row) => {
    const written = row.status === "Check written";
    // The bank mails a bill pay payment by itself, so returning one means cancelling it there first: AP says they have.
    if (written && paidByBillPay(row) && !input.cancelledAtBank) throw new ApActionError("cancel");
    const number = String(row.check_number ?? "").trim();
    const voided = written && number ? paymentNote(row, number, row.check_date) + (paidByBillPay(row) ? ", cancelled at the bank" : "") : "";
    return {
      patch: { status: "Returned", returned_note: note, returned_by: lowerEmail(input.by), returned_at: now.toISOString(), check_number: "", check_date: "", check_written_by: "" },
      records: [...(voided ? [{ action: "void", note: voided }] : []), { action: "return", note }],
    };
  });

  try {
    const mail = apReturnedEmail({
      requestId: before.request_id,
      version: versionOf(before),
      payeeName: before.payee_name,
      amountCents: parseMoney(String(before.reimbursement_claimed ?? "")) ?? 0,
      note,
      linkBase: input.linkBase,
      // The chair signs the new version again when they signed this one, and a bill pay check needs both check signers again.
      chairEvent: before.chair_step === "Signed" ? before.event : "",
      mailed: paidByBillPay(before),
      voided: before.status === "Check written",
      // A request from before the portal kept its JSON can't be refilled: the requester starts a new one.
      canFix: Boolean(String(before.request_file_id ?? "").trim()),
    });
    await adapters.mailer.send({ to: [before.requester_email], cc: [config.apEmail], replyTo: config.apEmail, subject: mail.subject, text: mail.text });
    return { row: after, emailed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ap return] the email for ${before.request_id} failed: ${message}`);
    await appendNotes(adapters.log, before.request_id, [`Email that AP sent it back failed: ${message}`]);
    return { row: after, emailed: false };
  }
}

/**
 * Records the check (Check written), or, for a mailed check, the bill pay
 * payment: its confirmation and the day it was set up. The category must be
 * set first. With `sent`, the check is already signed by both and gone (or
 * the bank has mailed it), so the request is Paid at once, as of today, and
 * the requester told.
 */
export async function recordPayment(input: StepInput & { checkNumber: string; checkDate: string; sent: boolean }, adapters: Adapters): Promise<StepResult> {
  const now = input.now ?? new Date();
  const number = oneLine(input.checkNumber);
  if (!number || number.length > CHECK_NUMBER_MAX) throw new ApActionError("check-number");
  const day = checkedDay(input.checkDate, now);
  const by = lowerEmail(input.by);
  // Recorded as sent now: the day it went out is today, whatever the check's date.
  const today = formatIsoDate(now);
  const { after } = await act(adapters, { ...input, now }, "record", (row) => {
    if (!String(row.budget_category ?? "").trim()) throw new ApActionError("category");
    // A check can't be written before the request was signed: most likely a mistyped year.
    const signed = parseDate(row.submitted_at);
    if (signed && day < formatIsoDate(signed)) throw new ApActionError("before-signed");
    return {
      patch: {
        status: input.sent ? "Paid" : "Check written",
        check_number: number,
        check_date: day,
        check_written_by: by,
        ...(input.sent ? { paid_date: today, paid_by: by } : {}),
      },
      records: [{ action: "check", note: paymentNote(row, number, day) }, ...(input.sent ? [{ action: "sent", note: `on ${formatDay(today)}` }] : [])],
    };
  });
  return { row: after, emailed: input.sent ? await emailPaid(after, adapters) : null };
}

/** The check has both signatures and has gone out (or the bank has mailed it): Paid, and the requester told. */
export async function markSent(input: StepInput & { paidDate: string }, adapters: Adapters): Promise<StepResult> {
  const now = input.now ?? new Date();
  const day = checkedDay(input.paidDate, now);
  const { after } = await act(adapters, { ...input, now }, "sent", (row) => {
    const written = parseDay(row.check_date);
    if (written && day < written) throw new ApActionError("before-check");
    return { patch: { status: "Paid", paid_date: day, paid_by: lowerEmail(input.by) }, records: [{ action: "sent", note: `on ${formatDay(day)}` }] };
  });
  return { row: after, emailed: await emailPaid(after, adapters) };
}

/**
 * The Paid email. A bill pay payment's address and amount come from the
 * request's JSON, checked against the signed packet, never the row; when that
 * can't be read the email leaves both out rather than repeat the Sheet's.
 */
async function emailPaid(row: RequestRow, adapters: Adapters): Promise<boolean> {
  try {
    const how = paidHow(row);
    let amountCents: number | null = how === "bill pay" ? null : (parseMoney(String(row.reimbursement_claimed ?? "")) ?? 0);
    let address: string | undefined;
    if (how === "bill pay") {
      try {
        const stored = await loadCheckedRequest(adapters.files, row);
        address = formatAddress(stored.request);
        amountCents = totals(stored.request).reimbursementCents;
      } catch (error) {
        console.error(`[ap paid] ${row.request_id}'s request JSON couldn't be checked, so the Paid email leaves out the address and amount:`, error);
      }
    }
    const mail = paidEmail({
      requestId: row.request_id,
      version: versionOf(row),
      payeeName: row.payee_name,
      amountCents,
      how,
      checkNumber: row.check_number,
      paidDate: row.paid_date,
      address,
    });
    await adapters.mailer.send({ to: [row.requester_email], replyTo: config.apEmail, subject: mail.subject, text: mail.text });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ap paid] the email for ${row.request_id} failed: ${message}`);
    await appendNotes(adapters.log, row.request_id, [`Email that it was paid failed: ${message}`]);
    return false;
  }
}
