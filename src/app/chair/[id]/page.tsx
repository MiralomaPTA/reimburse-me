import type { Metadata } from "next";
import { getAdapters } from "@/server/adapters";
import { config } from "@/server/config";
import { chairLinkState, chairStateMessage } from "@/server/requests/chair";
import { formatDateTime } from "@/lib/dates";
import type { EventBudget } from "@/lib/events";
import { formatMoney } from "@/lib/money";
import { CHECK_DELIVERY_LABEL, totals } from "@/lib/request-schema";
import { ChairSignForm } from "@/components/ChairSignForm";
import { MailtoLink } from "@/components/MailtoLink";

export const metadata: Metadata = {
  title: "Sign as event chair · Miraloma PTA Reimbursements",
  // The link's token is in the URL; keep it out of Referer headers and search indexes.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/**
 * Opened from the email to an event chair. The token in the link is the only
 * authorization: no account or sign-in. Opening the page changes nothing;
 * signing is a separate press of a button.
 */
export default async function ChairPage(props: PageProps<"/chair/[id]">) {
  const { id } = await props.params;
  const query = await props.searchParams;
  const token = typeof query.t === "string" ? query.t : "";
  const state = await chairLinkState(id, token, await getAdapters());
  const pdfHref = `/chair/${encodeURIComponent(id)}/pdf?t=${encodeURIComponent(token)}`;

  if (state.kind !== "ready") {
    const title = state.kind === "signed" ? "Already signed" : state.kind === "invalid" ? "This link isn't valid" : "Nothing to sign";
    return (
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-neutral-700">{chairStateMessage(state)}</p>
        {state.kind === "signed" && (
          <a href={pdfHref} target="_blank" rel="noopener" className="btn-secondary">
            Open the co-signed PDF
          </a>
        )}
        <p className="text-sm text-neutral-500">
          Questions? Write to the PTA at <MailtoLink email={config.apEmail} />.
        </p>
      </div>
    );
  }

  const { row, link, stored, budget } = state;
  const { request } = stored;
  const t = totals(request);
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-neutral-500">
          {row.request_id} · for {row.event}
        </p>
        <h1 className="text-2xl font-semibold">Please sign as {row.event} chair</h1>
        <p className="mt-1 text-neutral-700">
          {request.payeeName} asked the PTA to reimburse {formatMoney(t.reimbursementCents)} of {row.event} expenses. Check the request below, then sign
          on the form&apos;s VP/Chairman line. Once you sign, it goes on to the PTA for payment.
        </p>
      </div>

      {budget && <BudgetPanel event={row.event} budget={budget} />}

      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">The request</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Row label="From" value={`${request.payeeName}, ${request.ptaPosition}`} />
          <Row label="Email" value={stored.requesterEmail} />
          <Row label="Signed" value={formatDateTime(new Date(row.submitted_at))} />
          <Row label="Expenditure was for" value={request.purpose} />
          <Row label="Check" value={CHECK_DELIVERY_LABEL[request.checkDelivery]} />
        </dl>
        <div>
          <h3 className="mb-2 text-sm font-medium text-neutral-500">Line items</h3>
          <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 text-sm">
            {request.items.map((item, i) => (
              <li key={i} className="flex items-start justify-between gap-4 px-3 py-2">
                <span>
                  {i + 1}. {item.description}
                </span>
                <span className="shrink-0 font-medium">{formatMoney(item.amountCents)}</span>
              </li>
            ))}
          </ul>
        </div>
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-neutral-600">Total expense</dt>
          <dd className="text-right">{formatMoney(t.totalCents)}</dd>
          {t.donationCents > 0 && (
            <>
              <dt className="text-neutral-600">Donated to the PTA</dt>
              <dd className="text-right">{formatMoney(t.donationCents)}</dd>
            </>
          )}
          <dt className="font-medium">Reimbursement claimed</dt>
          <dd className="text-right font-semibold">{formatMoney(t.reimbursementCents)}</dd>
        </dl>
      </section>

      <section className="card p-2">
        <iframe src={pdfHref} title={`The signed request ${row.request_id}, with its receipts`} className="h-[70vh] w-full rounded" />
        <div className="px-2 pt-2 text-sm">
          <a href={pdfHref} target="_blank" rel="noopener" className="underline">
            Open the form and receipts in a new tab
          </a>
        </div>
      </section>

      <ChairSignForm requestId={row.request_id} token={token} event={row.event} payeeName={request.payeeName} pdfHref={pdfHref} sendPacketsTo={config.sendPacketsTo} />

      <p className="text-sm text-neutral-600">
        Something not right? Reply to the email you got, which goes to {request.payeeName}, or write to them at <MailtoLink email={stored.requesterEmail} />.
        You&apos;re signing as {link.email}.
      </p>
    </div>
  );
}

/** "$380.00 left" or "$12.50 over". */
const left = (cents: number) => (cents < 0 ? `${formatMoney(-cents)} over` : `${formatMoney(cents)} left`);

/** The event's budget before and after this request. A warning when it goes over, never a block: AP decides. */
function BudgetPanel({ event, budget }: { event: string; budget: EventBudget }) {
  const over = budget.leftAfterCents < 0;
  return (
    <section className="card space-y-3">
      <h2 className="text-lg font-semibold">{event} budget</h2>
      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-neutral-600">Budget this year</dt>
        <dd className="text-right">{formatMoney(budget.budgetCents)}</dd>
        <dt className="text-neutral-600">Claimed by other requests</dt>
        <dd className="text-right">{formatMoney(budget.usedBeforeCents)}</dd>
        <dt className="text-neutral-600">Before this request</dt>
        <dd className={`text-right ${budget.leftBeforeCents < 0 ? "text-amber-800" : ""}`}>{left(budget.leftBeforeCents)}</dd>
        <dt className="text-neutral-600">This request</dt>
        <dd className="text-right">{formatMoney(budget.thisCents)}</dd>
        <dt className="font-medium">After this request</dt>
        <dd className={`text-right font-semibold ${over ? "text-amber-800" : ""}`}>{left(budget.leftAfterCents)}</dd>
      </dl>
      {over && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          This request takes the {event} budget over by {formatMoney(Math.min(-budget.leftAfterCents, budget.thisCents))}. You can still sign it; the PTA decides
          what to reimburse.
        </p>
      )}
      <p className="text-xs text-neutral-500">Counts every {event} request this fiscal year, paid or not, except ones sent back.</p>
    </section>
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
