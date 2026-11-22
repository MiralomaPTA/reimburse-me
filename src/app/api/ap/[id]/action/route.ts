import type { NextRequest } from "next/server";
import { getAdapters } from "@/server/adapters";
import { ApActionError, approveRequest, markSent, recordPayment, returnRequest, type StepResult } from "@/server/ap/actions";
import { linkBase } from "@/server/auth/links";
import { isAp } from "@/server/auth/roles";
import { getApprovedSession } from "@/server/auth/session";
import { seeOther } from "@/server/http";

// The row lock waits 1.5 seconds before the step, and returning or paying sends an email.
export const maxDuration = 60;

/**
 * AP's steps on a request page: approve, return with a note, record the check
 * or bill pay payment, and mark it sent. Each goes back to the page with what
 * happened as a code (`done` or `problem`), which the page words, so nothing
 * in the URL is shown as it is.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/ap/[id]/action">) {
  const { id } = await ctx.params;
  const page = `/ap/${encodeURIComponent(id)}`;
  const session = await getApprovedSession();
  if (!session) return seeOther(`/?next=${encodeURIComponent(page)}`);
  if (!isAp(session.user)) return seeOther("/requests");
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "");
  const input = { requestId: id, by: session.email };
  try {
    const adapters = await getAdapters();
    let done: string;
    let result: StepResult;
    switch (field("action")) {
      case "approve":
        done = "approve";
        result = await approveRequest(input, adapters);
        break;
      case "return":
        done = "return";
        result = await returnRequest({ ...input, note: field("note"), linkBase: linkBase(request) }, adapters);
        break;
      case "record": {
        const sent = field("sent") === "1";
        done = sent ? "paid" : "record";
        result = await recordPayment({ ...input, checkNumber: field("checkNumber"), checkDate: field("checkDate"), sent }, adapters);
        break;
      }
      case "sent":
        done = "sent";
        result = await markSent({ ...input, paidDate: field("paidDate") }, adapters);
        break;
      default:
        return seeOther(`${page}?problem=unknown`);
    }
    return seeOther(`${page}?done=${done}${result.emailed === false ? "&emailed=0" : ""}`);
  } catch (error) {
    if (error instanceof ApActionError) return seeOther(`${page}?problem=${error.problem}`);
    console.error("[ap action]", error);
    return seeOther(`${page}?problem=failed`);
  }
}
