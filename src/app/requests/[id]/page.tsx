import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdapters } from "@/server/adapters";
import { requireApprovedSession } from "@/server/auth/session";
import { formatDateTime } from "@/lib/dates";
import { formatMoney, parseMoney } from "@/lib/money";
import { StatusBadge } from "@/components/StatusBadge";

export default async function RequestPage(props: PageProps<"/requests/[id]">) {
  const { id } = await props.params;
  const session = await requireApprovedSession(`/requests/${id}`);
  const { log } = await getAdapters();
  const row = await log.get(id);
  if (!row || row.requester_email.toLowerCase() !== session.email.toLowerCase()) notFound();

  const money = (s: string) => formatMoney(parseMoney(s) ?? 0);
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
        <Row label="Check" value={row.check_delivery === "mail" ? `Mail to ${row.address}, ${row.city_zip}` : "Staff mailbox"} />
        <Row label="Line items" value={`${row.line_count}, ${row.receipt_count} receipt${row.receipt_count === 1 ? "" : "s"}`} />
        <Row label="Total expense" value={money(row.total_expense)} />
        {parseMoney(row.donation_to_pta) ? <Row label="Donated to PTA" value={money(row.donation_to_pta)} /> : null}
        <Row label="Reimbursement claimed" value={money(row.reimbursement_claimed)} />
        {row.funding ? <Row label="Paid from" value={row.funding} /> : null}
      </dl>

      <div className="flex flex-wrap gap-3">
        <a href={`/requests/${row.request_id}/pdf`} target="_blank" rel="noopener" className="btn-primary">
          Open signed PDF
        </a>
      </div>
      <p className="text-xs text-neutral-500">SHA-256 of the signed file: {row.pdf_sha256}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
