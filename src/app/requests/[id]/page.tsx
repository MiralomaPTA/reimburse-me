import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdapters } from "@/server/adapters";
import { requireApprovedSession } from "@/server/auth/session";
import { config } from "@/server/config";
import { nextResendAt, type ResendProblem } from "@/server/requests/chair";
import { formatDateTime } from "@/lib/dates";
import { formatMoney, parseMoney } from "@/lib/money";
import { MailtoLink } from "@/components/MailtoLink";
import { StatusBadge } from "@/components/StatusBadge";
import type { RequestRow } from "@/server/adapters/types";

export default async function RequestPage(props: PageProps<"/requests/[id]">) {
  const { id } = await props.params;
  const query = await props.searchParams;
  const session = await requireApprovedSession(`/requests/${id}`);
  const { log } = await getAdapters();
  const row = await log.get(id);
  if (!row || row.requester_email.toLowerCase() !== session.email.toLowerCase()) notFound();

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

      {row.status === "Awaiting chair" && <AwaitingChair row={row} resent={query.resent === "1"} problem={typeof query.resend === "string" ? (query.resend as ResendProblem) : null} />}
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
    case "Signed":
      return `${row.chair_name || row.chair_signed_by} (${row.chair_signed_by}), ${formatDateTime(new Date(row.chair_signed_at))}`;
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
  failed: "The email didn't go through. Please try again in a few minutes.",
};

/** Who the request is waiting for, and the requester's "Resend to the chair". */
function AwaitingChair({ row, resent, problem }: { row: RequestRow; resent: boolean; problem: ResendProblem | null }) {
  const next = nextResendAt(row);
  const canResend = !next || next <= new Date();
  return (
    <div className="space-y-3 rounded-md border border-violet-300 bg-violet-50 p-4 text-sm text-violet-950">
      <div className="font-medium">Waiting for the {row.event} chair to sign</div>
      {row.chair_sent_at ? (
        <p>
          Sent to {row.chair_sent_to} on {formatDateTime(new Date(row.chair_sent_at))}. Once they sign the form&apos;s VP/Chairman line,{" "}
          {config.sendPacketsTo === "ap" ? "it goes to the PTA by itself." : "you'll get the co-signed PDF by email to forward to the PTA."}
        </p>
      ) : (
        <p>The email to the chair ({row.chair_sent_to}) didn&apos;t go through. Send it again below.</p>
      )}
      {resent && <p className="font-medium">Sent again. The chair has a fresh link.</p>}
      {problem && RESEND_PROBLEMS[problem] && <p className="font-medium text-amber-900">{RESEND_PROBLEMS[problem]}</p>}
      {canResend ? (
        <form action={`/api/requests/${encodeURIComponent(row.request_id)}/resend-chair`} method="post">
          <button type="submit" className="btn-secondary">
            Resend to the chair
          </button>
        </form>
      ) : (
        <p className="text-violet-900">You can send it again after {formatDateTime(next!)} if they haven&apos;t signed by then.</p>
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
