import { fiscalYearSpan } from "@/lib/fiscal-year";
import { formatMoney } from "@/lib/money";
import type { FundingOptions, StipendStatus } from "@/server/requests/stipends";

/** "$130.00 left", "$40.00 over", or null when the stipend has no amount set. */
export function stipendLeft(stipend: StipendStatus, minusCents = 0): string | null {
  if (stipend.remainingCents === null) return null;
  const left = stipend.remainingCents - minusCents;
  return left < 0 ? `${formatMoney(-left)} over` : `${formatMoney(left)} left`;
}

/** The requester's stipends this fiscal year: what's been claimed from each and what's left. */
export function StipendSummary({ funding }: { funding: FundingOptions }) {
  return (
    <section className="card space-y-5">
      <div>
        <h2 className="font-semibold">{funding.fiscalYear} stipends</h2>
        <p className="text-sm text-neutral-500">{fiscalYearSpan(funding.fiscalYear)}</p>
      </div>
      {funding.stipends.map((stipend) => (
        <StipendBar key={stipend.id} stipend={stipend} />
      ))}
    </section>
  );
}

function StipendBar({ stipend }: { stipend: StipendStatus }) {
  const { label, sharedWith, amountCents, usedCents, paidCents, remainingCents } = stipend;
  const unpaidCents = usedCents - paidCents;
  const claimed = `${formatMoney(usedCents)}${amountCents === null ? "" : ` of ${formatMoney(amountCents)}`} claimed${sharedWith ? ` by ${sharedWith}` : ""}`;
  const unpaid = unpaidCents > 0 ? `, including ${formatMoney(unpaidCents)} not paid yet` : "";
  const over = remainingCents !== null && remainingCents < 0;
  const percent = amountCents === null ? 0 : Math.min(100, Math.round((usedCents / Math.max(amountCents, 1)) * 100));
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-medium">{label}</div>
          {sharedWith && <div className="text-sm text-neutral-500">Shared with {sharedWith}</div>}
        </div>
        <div className={`text-right font-semibold ${over ? "text-amber-800" : ""}`}>{stipendLeft(stipend) ?? <span className="font-normal text-neutral-500">No amount set</span>}</div>
      </div>
      {amountCents !== null && (
        <div className="h-2 overflow-hidden rounded-full bg-neutral-200" role="progressbar" aria-label={`${label} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <div className={`h-full rounded-full ${over ? "bg-amber-500" : "bg-blue-700"}`} style={{ width: `${percent}%` }} />
        </div>
      )}
      <p className="text-sm text-neutral-600">
        {claimed}
        {unpaid}.
      </p>
    </div>
  );
}
