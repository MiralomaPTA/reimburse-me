import { getAdapters } from "@/server/adapters";
import { verifyApprovalToken } from "@/server/auth/tokens";
import { formatDateTime } from "@/lib/dates";

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

  const { users } = await getAdapters();
  const record = await users.get(email);
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
      <form action="/api/auth/approve" method="post" className="flex flex-wrap gap-3">
        <input type="hidden" name="token" value={token} />
        <button type="submit" name="decision" value="approve" className="btn-primary">
          Approve {email}
        </button>
        <button type="submit" name="decision" value="deny" className="btn-secondary">
          Deny
        </button>
      </form>
    </div>
  );
}
