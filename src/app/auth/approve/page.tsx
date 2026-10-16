import { getAdapters } from "@/server/adapters";
import { verifyApprovalToken } from "@/server/auth/tokens";
import { gradeName, parseAmount, parseGrades, stipendGrades } from "@/server/requests/stipends";
import { formatDateTime } from "@/lib/dates";
import { moneyPlain } from "@/lib/money";

/** Opened from the approval email. A click, not the GET, applies the decision. */
export default async function ApprovePage(props: PageProps<"/auth/approve">) {
  const query = await props.searchParams;
  const token = typeof query.token === "string" ? query.token : "";
  const email = token ? await verifyApprovalToken(token) : null;

  if (!email) {
    return (
      <div className="mx-auto max-w-md">
        <h1 className="mb-2 text-2xl font-semibold">This approval link isn&apos;t valid</h1>
        <p className="text-neutral-700">
          It may have expired (links work for 7 days) or been copied incompletely. If the person still needs access, ask them
          to request a sign-in link again and a fresh approval email will arrive.
        </p>
      </div>
    );
  }

  const { users, stipends } = await getAdapters();
  const [record, stipendRows] = await Promise.all([users.get(email), stipends.list()]);
  const teaches = parseGrades(record?.grade);
  const grades = [...new Set([...stipendGrades(stipendRows), ...teaches])];
  const stipendCents = parseAmount(record?.stipend);
  // AP and admin are set in the Users tab; this page only chooses between teacher and staff.
  const fixedRole = record?.role === "ap" || record?.role === "admin" ? record.role : null;
  // A pending row's "requester" is only the default, so make the approver choose.
  const role = record?.status === "approved" ? record.role : null;
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-semibold">Approve portal access?</h1>
      <div className="card text-sm">
        <div className="text-neutral-500">Email</div>
        <div className="mb-3 font-medium">{email}</div>
        <div className="text-neutral-500">Requested</div>
        <div className="mb-3 font-medium">{record?.requested_at ? formatDateTime(new Date(record.requested_at)) : "unknown"}</div>
        <div className="text-neutral-500">Current status</div>
        <div className="font-medium capitalize">{record?.status ?? "not on the list yet"}</div>
      </div>
      <p className="text-sm text-neutral-600">
        Approving lets this address sign in and submit reimbursement requests. It does not approve any payment; every
        request still comes to the AP team for review.
      </p>
      <form action="/api/auth/approve" method="post" className="group space-y-4">
        <input type="hidden" name="token" value={token} />
        {fixedRole ? (
          <p className="text-sm text-neutral-600">
            Role: <strong className="uppercase">{fixedRole}</strong>, set in the Users tab.
          </p>
        ) : (
          <>
            <fieldset>
              <legend className="label">They are</legend>
              <div className="space-y-2 text-sm">
                <label className="flex items-start gap-2">
                  <input type="radio" id="role-teacher" name="role" value="teacher" className="mt-1" defaultChecked={role === "teacher"} required />
                  <span>
                    <span className="font-medium">A teacher</span>
                    <span className="block text-neutral-500">
                      Each request comes from their classroom stipend, the shared stipend of a grade they teach, the field-trip fund, or none.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="radio" name="role" value="requester" className="mt-1" defaultChecked={role === "requester"} />
                  <span>
                    <span className="font-medium">Staff or a volunteer</span>
                    <span className="block text-neutral-500">With a stipend below, each request comes from it or not; without one, they aren&apos;t asked.</span>
                  </span>
                </label>
              </div>
            </fieldset>
            <fieldset className="hidden group-has-[#role-teacher:checked]:block" aria-describedby="grade_help">
              <legend className="label">Grades they teach</legend>
              <div className="flex flex-wrap gap-2">
                {grades.map((g) => (
                  <label
                    key={g}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50"
                  >
                    <input type="checkbox" name="grade" value={g} defaultChecked={teaches.includes(g)} />
                    {gradeName(g)}
                  </label>
                ))}
              </div>
              <p id="grade_help" className="mt-1 text-xs text-neutral-500">
                They can draw on each ticked grade&apos;s shared stipend; tick several for a combination class. Leave all unticked for
                a teacher of no one grade, such as a specialist. The amounts are in the Stipends tab.
              </p>
            </fieldset>
          </>
        )}
        <div>
          <label htmlFor="stipend" className="label">
            Their own stipend <span className="font-normal text-neutral-500">(optional)</span>
          </label>
          <div className="relative w-40">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-neutral-500">$</span>
            <input
              id="stipend"
              name="stipend"
              className="field pl-7"
              inputMode="decimal"
              placeholder="None"
              pattern="[$]?[0-9,]*([.][0-9]{0,2})?"
              defaultValue={stipendCents === null ? "" : moneyPlain(stipendCents)}
              aria-describedby="stipend_help"
            />
          </div>
          {query.error === "stipend" && <p className="mt-1 text-sm text-red-700">Enter the stipend as an amount, like 300 or 300.00, or leave it blank.</p>}
          <p id="stipend_help" className="mt-1 text-xs text-neutral-500">
            For staff with a yearly stipend. For a teacher, leave blank to use the standard classroom amount. You can change all of
            this later in the Users tab (role, grade and stipend columns).
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="submit" name="decision" value="approve" className="btn-primary">
            Approve {email}
          </button>
          <button type="submit" name="decision" value="deny" className="btn-secondary" formNoValidate>
            Deny
          </button>
        </div>
      </form>
    </div>
  );
}
