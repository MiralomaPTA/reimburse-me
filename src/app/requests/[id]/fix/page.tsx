import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdapters } from "@/server/adapters";
import { requireApprovedSession } from "@/server/auth/session";
import { config } from "@/server/config";
import { mailingOffered } from "@/server/requests/mailing";
import { fixProblem, returnedBy } from "@/server/requests/resubmit";
import { versionOf } from "@/server/requests/rows";
import { currentFunding, parseGrades } from "@/server/requests/stipends";
import { loadStoredRequest } from "@/server/requests/stored";
import { findEvent, parseEvents, toFormEvent } from "@/lib/events";
import { gradeLabel } from "@/lib/pta-position";
import { NewRequestForm, type Requester } from "@/components/NewRequestForm";

/**
 * "Fix and re-sign": the form, filled in with a returned request as its
 * latest version was signed, receipts included, with the note that sent it
 * back. Signing it makes the request's next version (see resubmit.ts).
 */
export default async function FixRequestPage(props: PageProps<"/requests/[id]/fix">) {
  const { id } = await props.params;
  const session = await requireApprovedSession(`/requests/${id}/fix`);
  const { log, events, files, signatures } = await getAdapters();
  const row = await log.get(id);
  if (!row || row.requester_email.toLowerCase() !== session.email.toLowerCase()) notFound();
  const problem = fixProblem(row, session.email);
  if (problem) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">Nothing to fix</h1>
        <p className="text-neutral-700">{problem}</p>
        <Link href={`/requests/${encodeURIComponent(row.request_id)}`} className="btn-secondary">
          Open {row.request_id}
        </Link>
      </div>
    );
  }

  const [stored, by, funding, eventRows] = await Promise.all([loadStoredRequest(files, row.request_file_id), returnedBy(row, signatures), currentFunding(session.user), events.list()]);
  // Read from the account's Users row now; the server checks it again when the requester signs.
  const mailing = mailingOffered(session.user);
  const requester: Requester = { teacher: session.user.role === "teacher", grade: gradeLabel(parseGrades(session.user.grade)) };
  return (
    <NewRequestForm
      email={session.email}
      apEmail={config.apEmail}
      sendPacketsTo={config.sendPacketsTo}
      mailing={mailing}
      profile={null}
      requester={requester}
      funding={funding}
      // The active events, and the one this request already names even if it has been made inactive since. Only what the form needs.
      events={parseEvents(eventRows)
        .filter((e) => e.active || findEvent([e], row.event))
        .map(toFormEvent)}
      fix={{ requestId: row.request_id, version: versionOf(row), by, note: row.returned_note, request: stored.request }}
    />
  );
}
