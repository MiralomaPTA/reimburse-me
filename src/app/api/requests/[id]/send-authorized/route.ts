import type { NextRequest } from "next/server";
import { getAdapters } from "@/server/adapters";
import { linkBase } from "@/server/auth/links";
import { getApprovedSession } from "@/server/auth/session";
import { seeOther } from "@/server/http";
import { AuthorizedResendError, sendAuthorizedAgain } from "@/server/requests/signers";

// Under the row lock it reads the Sheet and Drive and sends emails with the packet attached; lock.ts counts on 60 seconds.
export const maxDuration = 60;

/** The requester's "Send it to the PTA", when the authorized packet's email to AP failed after the second signature. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/requests/[id]/send-authorized">) {
  const { id } = await ctx.params;
  const page = `/requests/${encodeURIComponent(id)}`;
  const session = await getApprovedSession();
  if (!session) return seeOther(`/?next=${encodeURIComponent(page)}`);
  try {
    await sendAuthorizedAgain({ requestId: id, requesterEmail: session.email, linkBase: linkBase(request) }, await getAdapters());
    return seeOther(`${page}?sent=ap`);
  } catch (error) {
    // A code, not the message: the page words it, so nothing in the URL is shown as-is.
    if (error instanceof AuthorizedResendError) return seeOther(`${page}?send-ap=${error.problem}`);
    console.error("[send authorized]", error);
    return seeOther(`${page}?send-ap=failed`);
  }
}
