import type { NextRequest } from "next/server";
import { getAdapters } from "@/server/adapters";
import { linkBase } from "@/server/auth/links";
import { getApprovedSession } from "@/server/auth/session";
import { seeOther } from "@/server/http";
import { SignerResendError, resendToSigners } from "@/server/requests/signers";

/** The requester's "Resend to the check signers" button on their request page. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/requests/[id]/resend-signers">) {
  const { id } = await ctx.params;
  const page = `/requests/${encodeURIComponent(id)}`;
  const session = await getApprovedSession();
  if (!session) return seeOther(`/?next=${encodeURIComponent(page)}`);
  try {
    await resendToSigners({ requestId: id, requesterEmail: session.email, linkBase: linkBase(request) }, await getAdapters());
    return seeOther(`${page}?resent=signers`);
  } catch (error) {
    // A code, not the message: the page words it, so nothing in the URL is shown as-is.
    if (error instanceof SignerResendError) return seeOther(`${page}?resend-signers=${error.problem}`);
    console.error("[resend signers]", error);
    return seeOther(`${page}?resend-signers=failed`);
  }
}
