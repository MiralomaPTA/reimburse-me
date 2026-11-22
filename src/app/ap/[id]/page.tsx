import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdapters } from "@/server/adapters";
import type { ActionRecord, RequestRow } from "@/server/adapters/types";
import { requireApSession } from "@/server/ap/access";
import { ageDays, categoryChoices, earlierPackets, formatAge, reachedApAt, UNCATEGORIZED } from "@/server/ap/dashboard";
import { mailedCheck } from "@/server/ap/mailed";
import { returnedAtOf, returnedBy } from "@/server/requests/resubmit";
import { versionOf } from "@/server/requests/rows";
import { formatDateTime, parseDate } from "@/lib/dates";
import { formatMoney, parseMoney } from "@/lib/money";
import { StatusBadge } from "@/components/StatusBadge";

const CATEGORY_PROBLEMS: Record<string, string> = {
  unknown: "That category isn't in the Categories tab any more. Reload the page and choose again.",
  "not-found": "That request wasn't found.",
  failed: "The category wasn't saved. Please try again in a minute.",
};

/** One request as AP sees it (Phase 2a): everything on its row, its files and history, and its budget category. */
export default async function ApRequestPage(props: PageProps<"/ap/[id]">) {
  const { id } = await props.params;
  const query = await props.searchParams;
  await requireApSession(`/ap/${id}`);
  const { log, files, categories, actions, signatures } = await getAdapters();
  const row = await log.get(id);
  if (!row) notFound();
  const [categoryRows, history, mail, returnedWho] = await Promise.all([
    categories.list(),
    actions.listFor(row.request_id),
    mailedCheck(row, files),
    row.status === "Returned" ? returnedBy(row, signatures) : Promise.resolve(null),
  ]);
  const choices = categoryChoices(categoryRows, row);
  const money = (s: string) => {
    const cents = parseMoney(String(s ?? ""));
    return cents === null ? s || "" : formatMoney(cents);
  };
  const version = versionOf(row);
  const reached = reachedApAt(row);
  const age = formatAge(ageDays(row, new Date()));
  const categoryProblem = typeof query.category === "string" ? (CATEGORY_PROBLEMS[query.category] ?? null) : null;
  const pdf = (file: string, v?: number) => `/ap/${encodeURIComponent(row.request_id)}/pdf?file=${file}${v ? `&v=${v}` : ""}`;
  const earlier = earlierPackets(row).length;
  const returnedAt = parseDate(returnedAtOf(row));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/ap" className="text-sm text-neutral-500 hover:underline">
          ← AP dashboard
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{row.request_id}</h1>
          <StatusBadge status={row.status} />
          {version > 1 && <span className="text-sm text-neutral-500">version {version}</span>}
        </div>
        <p className="text-neutral-600">{row.purpose}</p>
        <p className="text-sm text-neutral-500">
          {row.payee_name} · {row.requester_email}
        </p>
      </div>

      {mail?.kind === "problem" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-medium">Mailed check: pay only to the address and amount on the signed FO10</div>
          <p className="mt-1">{mail.problem}</p>
        </div>
      )}
      {mail?.kind === "before-bill-pay" && (
        <div className="rounded-md border border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-800">
          <div className="font-medium">Mailed check, from before bill pay: to {mail.address}</div>
          <p className="mt-1">A paper check from before mailing went through bill pay. The portal kept no copy of the address it was signed with then, so this one is the Sheet&apos;s and can&apos;t be checked here.</p>
        </div>
      )}
      {mail?.kind === "signed" && (
        <div className={`rounded-md border p-4 text-sm ${mail.differences.length ? "border-amber-300 bg-amber-50 text-amber-950" : "border-teal-300 bg-teal-50 text-teal-950"}`}>
          <div className="font-medium">
            Mailed check: {formatMoney(mail.amountCents)} to {mail.address}
          </div>
          <p className="mt-1">As signed. Pay only to the address and amount on the signed FO10; a change of address needs a new version.</p>
          {mail.differences.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 font-medium">
              {mail.differences.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {returnedWho && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-medium">
            Sent back by {returnedWho}
            {returnedAt ? ` on ${formatDateTime(returnedAt)}` : ""}
          </div>
          {row.returned_note.trim() && <p className="mt-1 whitespace-pre-wrap">{row.returned_note}</p>}
          <p className="mt-1">The requester can fix it and sign it again as version {version + 1}.</p>
        </div>
      )}

      <form action={`/api/ap/${encodeURIComponent(row.request_id)}/category`} method="post" className="card space-y-3">
        <label htmlFor="category" className="label">
          Budget category
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <select id="category" name="category" defaultValue={choices.selected} className="field sm:flex-1">
            <option value="">{choices.noneYet ? UNCATEGORIZED : "Not set"}</option>
            {choices.options.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          {choices.options.length > 0 && (
            <button type="submit" className="btn-primary">
              Save
            </button>
          )}
        </div>
        {choices.noneYet && <p className="text-sm text-neutral-600">The Categories tab in the Sheet has no categories yet. Once it has, they&apos;re offered here.</p>}
        {choices.suggested && <p className="text-sm text-neutral-600">Suggested by the FO10&apos;s Budget Account ({row.budget_account}). Not saved yet.</p>}
        {query.saved === "category" && <p className="text-sm font-medium text-emerald-800">Saved.</p>}
        {categoryProblem && <p className="text-sm font-medium text-amber-900">{categoryProblem}</p>}
      </form>

      <dl className="card grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Row label="Signed by the requester" value={dateTime(row.submitted_at)} />
        {reached && reached.getTime() !== parseDate(row.submitted_at)?.getTime() ? <Row label="Reached AP" value={formatDateTime(reached)} /> : null}
        {age ? <Row label="Waiting" value={age === "today" ? "Since today" : age} /> : null}
        <Row label="Name" value={row.payee_name} />
        <Row label="Email" value={row.requester_email} />
        <Row label="Phone" value={row.phone} />
        <Row label="PTA position" value={row.pta_position} />
        <Row label="Check" value={checkDelivery(row, mail?.kind === "before-bill-pay")} />
        <Row label="Line items" value={`${row.line_count}, ${row.receipt_count} receipt${Number(row.receipt_count) === 1 ? "" : "s"}`} />
        <Row label="Total expense" value={money(row.total_expense)} />
        {parseMoney(String(row.donation_to_pta ?? "")) ? <Row label="Donated to PTA" value={money(row.donation_to_pta)} /> : null}
        <Row label="Reimbursement claimed" value={money(row.reimbursement_claimed)} />
        {row.funding ? <Row label="Paid from" value={row.funding} /> : null}
        {row.event ? <Row label="Event" value={row.event} /> : null}
        {chairLine(row) ? <Row label="Chair signature" value={chairLine(row)!} /> : null}
        {row.chair_note.trim() ? <Row label="Chair's note to AP" value={row.chair_note} /> : null}
        {signerLine(row, 1) ? <Row label="Check signer 1" value={signerLine(row, 1)!} /> : null}
        {signerLine(row, 2) ? <Row label="Check signer 2" value={signerLine(row, 2)!} /> : null}
        {row.budget_account ? <Row label="Budget Account (FO10)" value={row.budget_account} /> : null}
        {row.payment_account ? <Row label="Payment Account (FO10)" value={row.payment_account} /> : null}
        {row.check_number ? <Row label="Check number" value={row.check_number} /> : null}
        {row.paid_date ? <Row label="Paid" value={row.paid_date} /> : null}
        {row.notes.trim() ? <Row label="Notes" value={row.notes} /> : null}
      </dl>

      <div className="card space-y-3 text-sm">
        <h2 className="font-semibold">Files</h2>
        <div className="flex flex-wrap gap-3">
          {row.authorized_pdf_file_id && (
            <a href={pdf("authorized")} target="_blank" rel="noopener" className="btn-primary">
              Authorized packet (FO10 signed by both)
            </a>
          )}
          {row.chair_pdf_file_id && (
            <a href={pdf("cosigned")} target="_blank" rel="noopener" className={row.authorized_pdf_file_id ? "btn-secondary" : "btn-primary"}>
              Co-signed packet
            </a>
          )}
          {row.pdf_file_id && (
            <a href={pdf("signed")} target="_blank" rel="noopener" className={row.authorized_pdf_file_id || row.chair_pdf_file_id ? "btn-secondary" : "btn-primary"}>
              Signed by the requester
            </a>
          )}
        </div>
        {earlier > 0 && (
          <p>
            Earlier versions, for reference (the Sheet keeps no SHA-256 for them, so they aren&apos;t checked):{" "}
            {Array.from({ length: earlier }, (_, i) => i + 1).map((v, i) => (
              <span key={v}>
                {i > 0 && ", "}
                <a href={pdf("signed", v)} target="_blank" rel="noopener" className="underline">
                  version {v}
                </a>
              </span>
            ))}
          </p>
        )}
        <p className="break-all text-xs text-neutral-500">
          {row.authorized_pdf_sha256 && (
            <>
              SHA-256 of the authorized file: {row.authorized_pdf_sha256}
              <br />
            </>
          )}
          {row.chair_pdf_sha256 && (
            <>
              SHA-256 of the co-signed file: {row.chair_pdf_sha256}
              <br />
            </>
          )}
          SHA-256 of the file the requester signed: {row.pdf_sha256}
        </p>
      </div>

      <div className="card space-y-2 text-sm">
        <h2 className="font-semibold">History</h2>
        {history.length === 0 ? (
          <p className="text-neutral-600">Nothing done in the dashboard yet.</p>
        ) : (
          <ul className="space-y-1">
            {[...history].reverse().map((record, i) => (
              <li key={i}>
                <span className="text-neutral-500">{dateTime(record.at)}</span> · {describe(record)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const dateTime = (cell: string) => {
  const at = parseDate(cell);
  return at ? formatDateTime(at) : cell || "";
};

function checkDelivery(row: RequestRow, beforeBillPay: boolean): string {
  if (row.check_delivery === "mail") return beforeBillPay ? "Mailed, a paper check from before bill pay" : "Mailed by bill pay";
  return row.check_delivery === "pickup" ? "Pickup from the PTA" : "Staff mailbox";
}

/** "treasurer@example.org set the category to Supplies" */
function describe(record: ActionRecord): string {
  if (record.action === "category") return record.note ? `${record.by} set the category to ${record.note}` : `${record.by} cleared the category`;
  return [record.by, record.action, record.note].filter(Boolean).join(" · ");
}

/** What happened on the VP/Chairman line, or null when the request isn't for an event or is still waiting. */
function chairLine(row: RequestRow): string | null {
  switch (row.chair_step) {
    case "Signed":
      return [row.chair_name || "The chair", row.chair_signed_by ? ` (${row.chair_signed_by})` : "", row.chair_signed_at ? `, ${dateTime(row.chair_signed_at)}` : ""].join("");
    case "Waiting":
      return `Waiting${row.chair_sent_to ? `; sent to ${row.chair_sent_to}` : ""}${row.chair_sent_at ? ` on ${dateTime(row.chair_sent_at)}` : ""}`;
    case "Skipped: requester is a chair":
      return "Not asked: the requester chairs this event";
    case "Skipped: no chair listed":
      return "Not asked: no chair was listed for this event";
    case "Sent back":
      return "Sent back by the chair";
    default:
      return null;
  }
}

/** "Lillie Coit (lillie@example.org), Nov 14, 2026, 3:20 PM PT. Note: …" */
function signerLine(row: RequestRow, slot: 1 | 2): string | null {
  const name = slot === 1 ? row.signer_1_name : row.signer_2_name;
  const email = slot === 1 ? row.signer_1_email : row.signer_2_email;
  const at = slot === 1 ? row.signer_1_signed_at : row.signer_2_signed_at;
  const note = slot === 1 ? row.signer_1_note : row.signer_2_note;
  if (!at) return null;
  return `${name || "A check signer"}${email ? ` (${email})` : ""}, ${dateTime(at)}${note.trim() ? `. Note: ${note}` : ""}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="whitespace-pre-wrap break-words font-medium">{value}</dd>
    </div>
  );
}
