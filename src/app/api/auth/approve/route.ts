import { getAdapters } from "@/server/adapters";
import { decideAccess } from "@/server/auth/access";
import { linkBase } from "@/server/auth/links";
import { verifyApprovalToken } from "@/server/auth/tokens";
import { seeOther } from "@/server/http";

/** The approver's click from the approve page. The emailed token is the authorization. */
export async function POST(request: Request) {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const decision = form.get("decision") === "deny" ? "deny" : "approve";
  const email = await verifyApprovalToken(token);
  if (!email) return seeOther("/auth/approve?expired=1");

  const { users, mailer } = await getAdapters();
  const record = await decideAccess({ email, decision, decidedBy: "approval email link", linkBase: linkBase(request) }, { users, mailer });
  return seeOther(`/auth/approve/done?status=${record.status}&email=${encodeURIComponent(record.email)}`);
}
