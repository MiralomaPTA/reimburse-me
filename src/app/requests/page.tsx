import Link from "next/link";
import { getAdapters } from "@/server/adapters";
import { requireApprovedSession } from "@/server/auth/session";
import { currentFunding } from "@/server/requests/stipends";
import { formatDateTime } from "@/lib/dates";
import { formatMoney, parseMoney } from "@/lib/money";
import { StipendSummary } from "@/components/StipendSummary";
import { StatusBadge } from "@/components/StatusBadge";

export default async function RequestsPage() {
  const session = await requireApprovedSession("/requests");
  const { log } = await getAdapters();
  const [rows, funding] = await Promise.all([log.listByEmail(session.email), currentFunding(session.user)]);
  rows.sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My requests</h1>
        <Link href="/requests/new" className="btn-primary">
          New request
        </Link>
      </div>
      {funding.stipends.length > 0 && (
        <div className="mb-6">
          <StipendSummary funding={funding} />
        </div>
      )}
      {rows.length === 0 ? (
        <div className="card text-neutral-600">
          You haven&apos;t submitted anything yet. <Link href="/requests/new" className="underline">Start a request</Link>.
        </div>
      ) : (
        <ul className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
          {rows.map((row) => (
            <li key={row.request_id}>
              <Link href={`/requests/${row.request_id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-neutral-50">
                <div className="min-w-0">
                  <div className="truncate font-medium">{row.purpose}</div>
                  <div className="text-sm text-neutral-500">
                    {row.request_id} · {formatDateTime(new Date(row.submitted_at))}
                    {row.funding ? ` · ${row.funding}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-medium">{formatMoney(parseMoney(row.reimbursement_claimed) ?? 0)}</span>
                  <StatusBadge status={row.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-sm text-neutral-500">Signed in as {session.email}.</p>
    </div>
  );
}
