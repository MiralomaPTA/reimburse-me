import type { Metadata } from "next";
import { getAdapters } from "@/server/adapters";
import { config } from "@/server/config";
import { versionOf } from "@/server/requests/rows";
import { signerLinkState, signerStateMessage } from "@/server/requests/signers";
import { formatDateTime, parseDate } from "@/lib/dates";
import { formatAddress } from "@/lib/mailing";
import { formatMoney } from "@/lib/money";
import { totals } from "@/lib/request-schema";
import { MailtoLink } from "@/components/MailtoLink";
import { SignerSignForm } from "@/components/SignerSignForm";
import { VersionNote } from "@/components/VersionNote";

export const metadata: Metadata = {
  title: "Authorize a mailed check · Miraloma PTA Reimbursements",
  // The link's token is in the URL; keep it out of Referer headers and search indexes.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/**
 * Opened from the email to a check signer. The token in the link is the only
 * authorization: no account or sign-in. Opening the page changes nothing, so
 * an email scanner that opens links can't sign; signing and sending back are
 * separate presses of a button. Once the request has left the signers, the
 * link shows only a status line.
 */
export default async function SignerPage(props: PageProps<"/signers/[id]">) {
  const { id } = await props.params;
  const query = await props.searchParams;
  const token = typeof query.t === "string" ? query.t : "";
  const state = await signerLinkState(id, token, await getAdapters());
  const pdfHref = (file: "packet" | "fo10") => `/signers/${encodeURIComponent(id)}/pdf?t=${encodeURIComponent(token)}&file=${file}`;

  if (state.kind !== "ready") {
    const title =
      state.kind === "invalid"
        ? "This link isn't valid"
        : state.kind === "signed-first"
          ? "You've signed this one"
          : state.kind === "mismatch"
            ? "This request can't be signed"
              : state.kind === "done" && state.row.signers_step === "Signed"
              ? "Authorized"
              : state.kind === "done" && state.row.signers_step === "Sent back"
                ? "Sent back"
                : "Nothing to sign";
    return (
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-neutral-700">{signerStateMessage(state)}</p>
        <p className="text-sm text-neutral-500">
          Questions? Write to the PTA at <MailtoLink email={config.apEmail} />.
        </p>
      </div>
    );
  }

  const { row, link, stored, slot, accounts, flags, chair } = state;
  const { request } = stored;
  const t = totals(request);
  const firstAt = parseDate(row.signer_1_signed_at);
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-neutral-500">
          {row.request_id}
          {stored.version > 1 ? `, version ${stored.version}` : ""} · mailed check
        </p>
        <h1 className="text-2xl font-semibold">{slot === 1 ? "Please authorize this payment" : "One more signature needed"}</h1>
        <p className="mt-1 text-neutral-700">
          {request.payeeName} asked the PTA to reimburse {formatMoney(t.reimbursementCents)} and chose to have the check mailed. The PTA&apos;s bank mails it by bill
          pay, so two of the PTA&apos;s check signers sign the FO10 below first.{" "}
          {slot === 2
            ? `${row.signer_1_name} signed the first line${firstAt ? ` on ${formatDateTime(firstAt)}` : ""}. Yours is the second signature, and then it goes to the PTA's accounts payable team.`
            : "Any two check signers may sign. As the first, you also confirm the Budget Account and Payment Account."}
        </p>
        {/* Check signers see the whole note, which may be what asked for a change of address. */}
        {stored.version > 1 && stored.answers && <VersionNote version={stored.version} answers={stored.answers} payeeName={request.payeeName} />}
      </div>

      {flags.length > 0 && (
        <section className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <h2 className="font-semibold">Worth a second look</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {flags.map((flag) => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
          <p className="mt-2 text-amber-900">These can be signs of a stolen account. If something seems off, check with {request.payeeName} by phone before signing.</p>
        </section>
      )}

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">The payment</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Row label="Pay to" value={request.payeeName} />
          <Row label="Amount" value={formatMoney(t.reimbursementCents)} />
          <Row label="Mail the check to" value={formatAddress(request)} />
          <Row label="Phone" value={request.phone} />
          {accounts.locked && <Row label="Budget Account" value={accounts.budgetAccount} />}
          {accounts.locked && <Row label="Payment Account" value={accounts.paymentAccount} />}
        </dl>
      </section>

      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">The request</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Row label="From" value={`${request.payeeName}, ${request.ptaPosition}`} />
          <Row label="Email" value={stored.requesterEmail} />
          <Row label="Signed" value={formatDateTime(new Date(stored.submittedAt))} />
          <Row label="Expenditure was for" value={request.purpose} />
          {row.event && <Row label="Event" value={row.event} />}
          {chair && <Row label="Event chair" value={"skipped" in chair ? chair.skipped : `Signed by ${chair.name}, ${formatDateTime(chair.signedAt)}`} />}
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

      <PdfFrame href={pdfHref("fo10")} title={`The FO10 for ${row.request_id}${slot === 2 ? ", with the first signature" : ""}`} label="Open the FO10 in a new tab" short />
      <PdfFrame href={pdfHref("packet")} title={`The signed request ${row.request_id}, with its receipts`} label="Open the request and receipts in a new tab" />

      <SignerSignForm
        requestId={row.request_id}
        token={token}
        slot={slot}
        version={versionOf(row)}
        payeeName={request.payeeName}
        accounts={accounts}
        billPayAccounts={config.billPayAccounts}
      />

      <p className="text-sm text-neutral-600">You&apos;re signing as {link.email}. A reply to the email you got goes to the PTA, so please don&apos;t forward it: it holds your link.</p>
    </div>
  );
}

function PdfFrame({ href, title, label, short = false }: { href: string; title: string; label: string; short?: boolean }) {
  return (
    <section className="card p-2">
      <iframe src={href} title={title} className={`${short ? "h-[60vh]" : "h-[70vh]"} w-full rounded`} />
      <div className="px-2 pt-2 text-sm">
        <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
          {label}
        </a>
      </div>
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
