import type { ReactNode } from "react";
import type { RequestRow } from "@/server/adapters/types";
import { availableActions, CHECK_NUMBER_MAX, isOwnRequest, NOTE_MAX, paidByBillPay, paidHow } from "@/server/ap/actions";
import { formatDay, formatIsoDate, parseDate, parseDay } from "@/lib/dates";
import { OnceForm } from "@/components/OnceForm";

/**
 * AP's steps on one request (Phase 2b): forms that post and come back to the
 * page, which work on a phone before scripts load, and post once when tapped
 * twice. Approve is one tap. Record, mark sent and return open a short form
 * each.
 */
export function ActionPanel({ row, email }: { row: RequestRow; email: string }) {
  const actions = availableActions(row, email);
  const action = `/api/ap/${encodeURIComponent(row.request_id)}/action`;
  const today = formatIsoDate(new Date());
  const billPay = paidByBillPay(row);
  const how = paidHow(row);
  const hasCategory = Boolean(String(row.budget_category ?? "").trim());
  const payment = billPay ? `bill pay confirmation ${row.check_number}` : `check #${row.check_number}`;
  // A check can't be dated before the request was signed.
  const signed = parseDate(row.submitted_at);
  const signedDay = signed ? formatIsoDate(signed) : undefined;

  if (isOwnRequest(row, email)) {
    return <Panel>This is your own request, so another AP member must approve, return or pay it.</Panel>;
  }
  if (actions.length === 0) return <Panel>{NOTHING_TO_DO[row.status] ?? "Nothing to do here at this status."}</Panel>;

  return (
    <div className="card space-y-4">
      <h2 className="font-semibold">Next step</h2>
      {row.status === "Check written" && (
        <p className="text-sm text-neutral-700">
          {billPay ? "Bill pay set up" : "Check written"}: {payment}, {billPay ? "set up" : "dated"} {formatDay(row.check_date)}
          {row.check_written_by ? `, by ${row.check_written_by}` : ""}.
        </p>
      )}

      {actions.includes("approve") && (
        <div className="space-y-1">
          <OnceForm action={action} label="Approve" busyLabel="Approving…">
            <input type="hidden" name="action" value="approve" />
          </OnceForm>
          <p className="text-sm text-neutral-600">Optional: you&apos;ve checked it and will pay it. Nobody is emailed.</p>
        </div>
      )}

      {actions.includes("record") && (
        <details className="rounded-md border border-neutral-200 p-3" open={!actions.includes("approve") && hasCategory}>
          <summary className="cursor-pointer font-medium">{billPay ? "Record bill pay" : "Record check"}</summary>
          {!hasCategory ? (
            <p className="mt-2 text-sm font-medium text-amber-900">Set the budget category above first.</p>
          ) : (
            <OnceForm action={action} label={billPay ? "Record bill pay" : "Record check"} busyLabel="Recording…" className="mt-3 space-y-3">
              <input type="hidden" name="action" value="record" />
              {billPay && <p className="text-sm text-neutral-700">Pay only to the address and amount on the signed FO10.</p>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="checkNumber" className="label">
                    {billPay ? "Confirmation or check number from the bank" : "Check number"}
                  </label>
                  <input id="checkNumber" name="checkNumber" required maxLength={CHECK_NUMBER_MAX} autoComplete="off" className="field" />
                </div>
                <div>
                  <label htmlFor="checkDate" className="label">
                    {billPay ? "Day the payment was set up" : "Date on the check"}
                  </label>
                  <input id="checkDate" name="checkDate" type="date" required defaultValue={today} min={signedDay} max={today} className="field" />
                </div>
              </div>
              <label className="flex items-start gap-2 text-sm text-neutral-700">
                <input type="checkbox" name="sent" value="1" className="mt-1" />
                <span>{SENT_NOW[how]} That makes it Paid today and emails the requester.</span>
              </label>
            </OnceForm>
          )}
        </details>
      )}

      {actions.includes("sent") && (
        <details className="rounded-md border border-neutral-200 p-3" open>
          <summary className="cursor-pointer font-medium">Mark sent</summary>
          <OnceForm action={action} label="Mark sent" busyLabel="Marking it sent…" className="mt-3 space-y-3">
            <input type="hidden" name="action" value="sent" />
            <p className="text-sm text-neutral-700">{WHERE_IT_GOES[how]} Marking it sent makes it Paid and emails the requester.</p>
            <div className="sm:w-1/2">
              <label htmlFor="paidDate" className="label">
                Day it went out
              </label>
              <input id="paidDate" name="paidDate" type="date" required defaultValue={today} min={parseDay(row.check_date) ?? undefined} max={today} className="field" />
            </div>
          </OnceForm>
        </details>
      )}

      {actions.includes("return") && (
        <details className="rounded-md border border-neutral-200 p-3">
          <summary className="cursor-pointer font-medium">Return with a note</summary>
          <OnceForm action={action} label="Return to the requester" busyLabel="Returning…" buttonClassName="btn-secondary" className="mt-3 space-y-3">
            <input type="hidden" name="action" value="return" />
            {row.status === "Check written" && !billPay && (
              <p className="rounded-md bg-amber-50 p-2 text-sm font-medium text-amber-900">This voids check #{row.check_number}: don&apos;t send it. The number stays in the history.</p>
            )}
            {row.status === "Check written" && billPay && (
              <label className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-sm font-medium text-amber-900">
                <input type="checkbox" name="cancelled" value="1" required className="mt-1" />
                <span>I&apos;ve cancelled the bill pay payment (confirmation {row.check_number}) at the bank, so it won&apos;t be mailed.</span>
              </label>
            )}
            <label htmlFor="note" className="label">
              What needs to change
            </label>
            <textarea id="note" name="note" required maxLength={NOTE_MAX} rows={3} className="field" />
            <p className="text-sm text-neutral-600">
              The requester gets this note by email,{" "}
              {String(row.request_file_id ?? "").trim() ? "with a link to fix the request and sign it again" : "and is asked to start a new request, since this one is too old to fix and sign again"}. You&apos;re copied.
            </p>
          </OnceForm>
        </details>
      )}
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="card space-y-1 text-sm text-neutral-700">
      <h2 className="font-semibold text-neutral-900">Next step</h2>
      <p>{children}</p>
    </div>
  );
}

const NOTHING_TO_DO: Partial<Record<RequestRow["status"], string>> = {
  "Awaiting chair": "Nothing yet: it's still with the event chair.",
  "Awaiting signers": "Nothing yet: it's still with the check signers.",
  Returned: "Nothing yet: it's waiting for the requester to fix it and sign again.",
  Paid: "Nothing: it's paid. Paid is final in the portal. To fix a mistake, edit the Sheet and say why in its notes.",
};

/** The Record form's "already sent" box. */
const SENT_NOW: Record<ReturnType<typeof paidHow>, string> = {
  mailbox: "Already signed by both and put in the staff mailbox.",
  pickup: "Already signed by both and picked up.",
  mailed: "Already signed by both and mailed.",
  "bill pay": "The bank has already mailed it.",
};

/** The Mark sent form's reminder. */
const WHERE_IT_GOES: Record<ReturnType<typeof paidHow>, string> = {
  mailbox: "This check goes in the requester's staff mailbox.",
  pickup: "The requester picks this check up from the PTA.",
  mailed: "This check is mailed to the requester.",
  "bill pay": "The bank mails this payment; mark it sent once it has.",
};
