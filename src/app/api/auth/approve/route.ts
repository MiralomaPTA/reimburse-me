import { getAdapters } from "@/server/adapters";
import { decideAccess } from "@/server/auth/access";
import { linkBase } from "@/server/auth/links";
import { verifyApprovalToken } from "@/server/auth/tokens";
import { seeOther } from "@/server/http";
import { normalizeGrade } from "@/server/requests/stipends";
import { moneyPlain, parseMoney } from "@/lib/money";

/** The approver's click from the approve page. The emailed token is the authorization. */
export async function POST(request: Request) {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const decision = form.get("decision") === "deny" ? "deny" : "approve";
  const email = await verifyApprovalToken(token);
  if (!email) return seeOther("/auth/approve?expired=1");

  // Blank means none. Stored as plain dollars, like the money columns in the request log.
  const stipendInput = String(form.get("stipend") ?? "").trim();
  const stipendCents = stipendInput ? parseMoney(stipendInput) : null;
  if (decision === "approve" && stipendInput && stipendCents === null) {
    return seeOther(`/auth/approve?token=${encodeURIComponent(token)}&error=stipend`);
  }

  // Absent when the page didn't ask (an AP or admin row): keep what the Sheet says.
  const roleInput = form.get("role");
  const role = roleInput === "teacher" || roleInput === "requester" ? roleInput : undefined;

  const { users, mailer } = await getAdapters();
  const record = await decideAccess(
    {
      email,
      decision,
      decidedBy: "approval email link",
      linkBase: linkBase(request),
      role,
      // One checkbox per grade; a combination class ticks several, stored as "1, 2".
      grade: role === "teacher" ? [...new Set(form.getAll("grade").map((g) => normalizeGrade(String(g))).filter(Boolean))].join(", ") : role ? "" : undefined,
      stipend: stipendCents === null ? "" : moneyPlain(stipendCents),
    },
    { users, mailer },
  );
  const done = new URLSearchParams({ status: record.status, email: record.email });
  if (record.status === "approved") {
    if (record.role === "teacher") done.set("teacher", record.grade || "yes");
    if (record.stipend) done.set("stipend", record.stipend);
  }
  return seeOther(`/auth/approve/done?${done}`);
}
