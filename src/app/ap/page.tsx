import Link from "next/link";
import { getAdapters } from "@/server/adapters";
import { requireApSession } from "@/server/ap/access";
import { ageDays, filtersQuery, fiscalYears, formatAge, matches, oldestFirst, parseFilters, STATUSES } from "@/server/ap/dashboard";
import { mailedCheck } from "@/server/ap/mailed";
import { versionOf } from "@/server/requests/rows";
import { formatDateShort, parseDate } from "@/lib/dates";
import { formatMoney, parseMoney } from "@/lib/money";
import { StatusBadge } from "@/components/StatusBadge";

/**
 * The AP dashboard (Phase 2a): every request with its age, oldest first,
 * read-only apart from the category on each request's page. By default it
 * shows what's with AP: not Paid, and not still with an event chair or the
 * check signers.
 */
export default async function ApPage(props: PageProps<"/ap">) {
  await requireApSession("/ap");
  const filters = parseFilters(await props.searchParams);
  const { log, files } = await getAdapters();
  const all = await log.list();
  const rows = oldestFirst(all.filter((row) => matches(row, filters)));
  const now = new Date();
  // A mailed check's address comes from what was signed, never the Sheet; the few on the list are read from Drive.
  const mailed = new Map(await Promise.all(rows.filter((row) => row.check_delivery === "mail").map(async (row) => [row.request_id, await mailedCheck(row, files)] as const)));
  const claimedCents = rows.reduce((sum, row) => sum + (parseMoney(String(row.reimbursement_claimed ?? "")) ?? 0), 0);
  const query = filtersQuery(filters);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">AP dashboard</h1>
        <a href={`/ap/export${query ? `?${query}` : ""}`} className="btn-secondary">
          Export CSV
        </a>
      </div>

      <form action="/ap" method="get" className="card grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
        <div>
          <label htmlFor="status" className="label">
            Status
          </label>
          <select id="status" name="status" defaultValue={filters.status} className="field">
            <option value="">With AP</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
            <option value="all">Everything</option>
          </select>
        </div>
        <div>
          <label htmlFor="fy" className="label">
            Fiscal year
          </label>
          <select id="fy" name="fy" defaultValue={filters.fy} className="field">
            <option value="">All years</option>
            {fiscalYears(all).map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="q" className="label">
            Search
          </label>
          <input id="q" name="q" type="search" defaultValue={filters.q} placeholder="Name, email, purpose or ID" className="field" />
        </div>
        <button type="submit" className="btn-primary">
          Show
        </button>
        <label className="flex items-center gap-2 text-sm text-neutral-700 sm:col-span-4">
          <input type="checkbox" name="paid" value="1" defaultChecked={filters.paid} />
          Show paid requests too, with “With AP”
        </label>
      </form>

      <p className="text-sm text-neutral-600">
        {rows.length === 1 ? "1 request" : `${rows.length} requests`}, {formatMoney(claimedCents)} claimed. Oldest first.
      </p>

      {rows.length === 0 ? (
        <div className="card text-neutral-600">Nothing matches.</div>
      ) : (
        <ul className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
          {rows.map((row) => {
            const age = formatAge(ageDays(row, now));
            const submitted = parseDate(row.submitted_at);
            const mail = mailed.get(row.request_id);
            const warning = mail && ("problem" in mail ? mail.problem : mail.differences.length > 0 ? "The Sheet differs from what was signed" : "");
            return (
              <li key={row.request_id}>
                <Link href={`/ap/${encodeURIComponent(row.request_id)}`} className="block px-4 py-3 hover:bg-neutral-50">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 truncate font-medium">{row.purpose || "(no purpose)"}</div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-medium">{formatMoney(parseMoney(String(row.reimbursement_claimed ?? "")) ?? 0)}</span>
                      <StatusBadge status={row.status} />
                    </div>
                  </div>
                  <div className="mt-0.5 text-sm text-neutral-500">
                    {[
                      row.request_id,
                      row.payee_name || row.requester_email,
                      submitted ? `signed ${formatDateShort(submitted)}` : "",
                      row.event,
                      row.budget_category || "No category",
                      age ? (age === "today" ? "since today" : `waiting ${age}`) : "",
                      versionOf(row) > 1 ? `v${versionOf(row)}` : "",
                      mail && !("problem" in mail) ? `Mail to ${mail.address}` : row.check_delivery === "mail" ? "Mail" : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {warning && <div className="mt-1 text-sm font-medium text-amber-800">⚠ {warning}</div>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
