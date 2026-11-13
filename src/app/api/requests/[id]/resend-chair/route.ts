import type { NextRequest } from "next/server";
import { getAdapters } from "@/server/adapters";
import { linkBase } from "@/server/auth/links";
import { getApprovedSession } from "@/server/auth/session";
import { seeOther } from "@/server/http";
import { ResendError, resendToChair } from "@/server/requests/chair";

/** The requester's "Resend to the chair" button on their request page. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/requests/[id]/resend-chair">) {
  const { id } = await ctx.params;
  const page = `/requests/${encodeURIComponent(id)}`;
  const session = await getApprovedSession();
  if (!session) return seeOther(`/?next=${encodeURIComponent(page)}`);
  try {
    await resendToChair({ requestId: id, requesterEmail: session.email, linkBase: linkBase(request) }, await getAdapters());
    return seeOther(`${page}?resent=1`);
  } catch (error) {
    // A code, not the message: the page words it, so nothing in the URL is shown as-is.
    if (error instanceof ResendError) return seeOther(`${page}?resend=${error.problem}`);
    console.error("[resend chair]", error);
    return seeOther(`${page}?resend=failed`);
  }
}
