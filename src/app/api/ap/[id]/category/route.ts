import type { NextRequest } from "next/server";
import { getAdapters } from "@/server/adapters";
import { getApprovedSession } from "@/server/auth/session";
import { CategoryError, setCategory } from "@/server/ap/category";
import { isAp } from "@/server/auth/roles";
import { seeOther } from "@/server/http";

/** The category dropdown's Save on an AP request page. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/ap/[id]/category">) {
  const { id } = await ctx.params;
  const page = `/ap/${encodeURIComponent(id)}`;
  const session = await getApprovedSession();
  if (!session) return seeOther(`/?next=${encodeURIComponent(page)}`);
  if (!isAp(session.user)) return seeOther("/requests");
  const form = await request.formData();
  try {
    await setCategory({ requestId: id, category: String(form.get("category") ?? ""), by: session.email }, await getAdapters());
    return seeOther(`${page}?saved=category`);
  } catch (error) {
    // A code, not the message: the page words it, so nothing in the URL is shown as-is.
    if (error instanceof CategoryError) return seeOther(`${page}?category=${error.problem}`);
    console.error("[ap category]", error);
    return seeOther(`${page}?category=failed`);
  }
}
