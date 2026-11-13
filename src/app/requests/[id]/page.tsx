import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdapters } from "@/server/adapters";
import { requireApprovedSession } from "@/server/auth/session";
import { config } from "@/server/config";
import { chairSending, type ChairSending, type ResendProblem } from "@/server/requests/chair";
import { formatDateTime, parseDate } from "@/lib/dates";
import { parseEvents } from "@/lib/events";
import { formatMoney, parseMoney } from "@/lib/money";
import { MailtoLink } from "@/components/MailtoLink";
import { PostButton } from "@/components/PostButton";
import { StatusBadge } from "@/components/StatusBadge";
import type { RequestRow } from "@/server/adapters/types";

export default async function RequestPage(props: PageProps<"/requests/[id]">) {
  const { id } = await props.params;
  const query = await props.searchParams;
  const session = await requireApprovedSession(`/requests/${id}`);
  const { log, events } = await getAdapters();
  const row = await log.get(id);
  if (!row || row.requester_email.toLowerCase() !== session.email.toLowerCase()) notFound();
  // Who the chair email has reached, against who the Events tab lists now.
  const sending = row.status === "Awaiting chair" ? chairSending(row, parseEvents(await events.list())) : null;
  const resendProblem = typeof query.resend === "string" && Object.hasOwn(RESEND_PROBLEMS, query.resend) ? RESEND_PROBLEMS[query.resend as ResendProblem] : null;

  const money = (s: string) => formatMoney(parseMoney(s) ?? 0);
  const cosigned = Boolean(row.chair_pdf_file_id);
  return (
    <div className="space-y-6">
      <div>
        <Link href="/requests" className="text-sm text-neutral-500 hover:underline">
          ← My requests
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{row.request_id}</h1>
          <StatusBadge status={row.status} />
        </div>
        <p className="text-neutral-600">{row.purpose}</p>
      </div>

      {sending && <AwaitingChair row={row} sending={sending} resent={query.resent === "1"} problem={resendProblem} />}
      {row.status === "Submitted" && config.sendPacketsTo === "requester" && (
        <div className="rounded-md border border-sky-300 bg-sky-50 p-4 text-sm text-sky-900">
          The portal doesn&apos;t send requests to the PTA yet. If you haven&apos;t already, email the {cosigned ? "co-signed" : "signed"} PDF below to{" "}
          <MailtoLink email={config.apEmail} /> to be reimbursed.
        </div>
      )}
      {row.status === "Returned" && row.returned_note && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <div className="font-medium">Returned by the AP team</div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{row.returned_note}</p>
        </div>
      )}
      {row.status === "Paid" && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-emerald-900">
          Paid with check #{row.check_number || "?"} {row.paid_date ? `on ${row.paid_date}` : ""}.
        </div>
      )}

      <dl className="card grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Row label="Submitted" value={formatDateTime(new Date(row.submitted_at))} />
        <Row label="Name" value={row.payee_name} />
        <Row label="PTA position" value={row.pta_position} />
        <Row label="Check" value={checkDelivery(row)} />
        <Row label="Line items" value={`${row.line_count}, ${row.receipt_count} receipt${row.receipt_count === 1 ? "" : "s"}`} />
        <Row label="Total expense" value={money(row.total_expense)} />
        {parseMoney(row.donation_to_pta) ? <Row label="Donated to PTA" value={money(row.donation_to_pta)} /> : null}
        <Row label="Reimbursement claimed" value={money(row.reimbursement_claimed)} />
        {row.funding ? <Row label="Paid from" value={row.funding} /> : null}
        {row.event ? <Row label="Event" value={row.event} /> : null}
        {chairLine(row) ? <Row label="Chair signature" value={chairLine(row)!} /> : null}
      </dl>

      <div className="flex flex-wrap gap-3">
        <a href={`/requests/${row.request_id}/pdf`} target="_blank" rel="noopener" className="btn-primary">
          {cosigned ? "Open co-signed PDF" : "Open signed PDF"}
        </a>
      </div>
      <p className="break-all text-xs text-neutral-500">
        {cosigned ? (
          <>
            SHA-256 of the co-signed file: {row.chair_pdf_sha256}
            <br />
            SHA-256 of the file you signed: {row.pdf_sha256}
          </>
        ) : (
          <>SHA-256 of the signed file: {row.pdf_sha256}</>
        )}
      </p>
    </div>
  );
}

/** What happened on the VP/Chairman line, or null when the request isn't for an event or is still waiting. */
function chairLine(row: RequestRow): string | null {
  switch (row.chair_step) {
    case "Signed": {
      const at = parseDate(row.chair_signed_at);
      return [row.chair_name || row.chair_signed_by || "The chair", row.chair_signed_by && row.chair_name ? ` (${row.chair_signed_by})` : "", at ? `, ${formatDateTime(at)}` : ""].join("");
    }
    case "Skipped: requester is a chair":
      return "Not asked: you're a chair of this event";
    case "Skipped: no chair listed":
      return "Not asked: no chair was listed for this event";
    case "Timed out":
      return "Not signed in time; sent on without it";
    case "Sent back":
      return "Sent back by the chair";
    default:
      return null;
  }
}

const RESEND_PROBLEMS: Record<ResendProblem, string> = {
  "not-found": "That request wasn't found.",
  closed: "This request isn't waiting for a chair's signature any more.",
  "too-soon": `You can resend once every ${config.chairResendHours} hours.`,
  "no-chair": `The PTA's list doesn't name a chair for this event right now. Ask the PTA at ${config.apEmail} what to do.`,
  "requester-chair": `You're listed as a chair of this event now, so it can't be sent to the chairs again. Ask the PTA at ${config.apEmail} what to do.`,
  busy: "It was already being sent. Reload this page in a minute to see when it went.",
  failed: "The email didn't go through. Please try again in a few minutes.",
};

/** Who the request is waiting for, and the requester's "Resend to the chair". */
function AwaitingChair({ row, sending, resent, problem }: { row: RequestRow; sending: ChairSending; resent: boolean; problem: string | null }) {
  const sentAt = parseDate(row.chair_sent_at);
  const { reached, unreached, to, nextAt } = sending;
  return (
    <div className="space-y-3 rounded-md border border-violet-300 bg-violet-50 p-4 text-sm text-violet-950">
      <div className="font-medium">Waiting for the {row.event} chair to sign</div>
      {reached.length > 0 ? (
        <p>
          Sent to {reached.join(", ")}
          {sentAt ? ` on ${formatDateTime(sentAt)}` : ""}. Once they sign the form&apos;s VP/Chairman line,{" "}
          {config.sendPacketsTo === "ap" ? "it goes to the PTA by itself." : "you'll get the co-signed PDF by email to forward to the PTA."}
        </p>
      ) : (
        <p>The email to the chair{unreached.length > 0 ? ` (${unreached.join(", ")})` : ""} didn&apos;t go through.</p>
      )}
      {reached.length > 0 && unreached.length > 0 && <p>It hasn&apos;t reached {unreached.join(", ")} yet.</p>}
      {resent && <p className="font-medium">Sent again. The chair has a fresh link.</p>}
      {problem && <p className="font-medium text-amber-900">{problem}</p>}
      {sending.requesterIsChair ? (
        <p className="text-violet-900">{RESEND_PROBLEMS["requester-chair"]}</p>
      ) : to.length > 0 ? (
        <>
          {nextAt && <p className="text-violet-900">Resend goes to {to.join(", ")} now, and to every chair after {formatDateTime(nextAt)}.</p>}
          <PostButton action={`/api/requests/${encodeURIComponent(row.request_id)}/resend-chair`} busyLabel="Sending…">
            Resend to the chair
          </PostButton>
        </>
      ) : nextAt ? (
        <p className="text-violet-900">You can send it again after {formatDateTime(nextAt)} if they haven&apos;t signed by then.</p>
      ) : (
        <p className="text-violet-900">{RESEND_PROBLEMS["no-chair"]}</p>
      )}
    </div>
  );
}

/** Rows from before pickup replaced mailing still carry the address the check went to. */
function checkDelivery(row: RequestRow): string {
  if (row.check_delivery === "mail") return `Mail to ${row.address}, ${row.city_zip}`;
  return row.check_delivery === "pickup" ? "Pickup from the PTA" : "Staff mailbox";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
