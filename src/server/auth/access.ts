import type { Mailer, UserDirectory, UserRecord } from "@/server/adapters/types";
import { createApprovalToken, createMagicToken } from "@/server/auth/tokens";
import { config } from "@/server/config";
import { approvalRequestEmail, approvedEmail, signInEmail } from "@/server/email/templates";

/**
 * Who may sign in, and what happens when someone asks for a link.
 *
 * - Approved address: email a sign-in link (at most one a minute, durably).
 * - Unknown address: add a pending row and ask the approver once. Nothing is
 *   ever emailed to the unknown address itself, so the form can't be used to
 *   spam strangers. Repeat requests send nothing more.
 * - Pending or denied address: nothing is sent.
 *
 * `deps` is injectable for tests.
 */

export interface AccessDeps {
  users: UserDirectory;
  mailer: Mailer;
  now?: () => Date;
}

export type SignInOutcome = "sent" | "pending";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function signInLink(base: string, token: string, next?: string): string {
  const url = new URL("/auth/callback", base);
  url.searchParams.set("token", token);
  if (next && next.startsWith("/") && !next.startsWith("//")) url.searchParams.set("next", next);
  return url.toString();
}

export async function requestSignIn(input: { email: string; linkBase: string; next?: string }, deps: AccessDeps): Promise<SignInOutcome> {
  const email = input.email.trim().toLowerCase();
  const now = (deps.now ?? (() => new Date()))();
  const record = await deps.users.get(email);

  if (record?.status === "approved") {
    const last = record.last_link_at ? Date.parse(record.last_link_at) : 0;
    if (now.getTime() - last < config.linkCooldownSeconds * 1000) return "sent"; // the earlier link is still good
    const mail = signInEmail(signInLink(input.linkBase, await createMagicToken(email), input.next));
    await deps.mailer.send({ to: [email], subject: mail.subject, text: mail.text });
    await deps.users.upsert({ ...record, last_link_at: now.toISOString() });
    return "sent";
  }
  if (record) return "pending"; // pending or denied: say nothing more, send nothing more

  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  if ((await deps.users.countPendingSince(since)) >= config.maxNewPendingPerDay) {
    console.warn(`[access] daily cap on new access requests reached; not recording ${email}`);
    return "pending";
  }
  await deps.users.upsert({
    email,
    role: "requester",
    status: "pending",
    requested_at: now.toISOString(),
    approved_at: "",
    approved_by: "",
    last_link_at: "",
    note: "",
    grade: "",
    stipend: "",
  });
  const url = new URL("/auth/approve", input.linkBase);
  url.searchParams.set("token", await createApprovalToken(email));
  const mail = approvalRequestEmail({ email, requestedAt: now, approveUrl: url.toString() });
  await deps.mailer.send({ to: [config.approverEmail], subject: mail.subject, text: mail.text });
  return "pending";
}

export type AccessDecision = "approve" | "deny";

/**
 * Applies the approver's decision. Approving emails the requester a sign-in
 * link; denying stays silent. `role`, `grade` and `stipend`, when given,
 * replace the row's values on approval ("" clears them); left out, the row's
 * are kept, so values preloaded in the Sheet survive. An AP or admin row keeps
 * its role: the approval page only chooses between teacher and staff.
 */
export async function decideAccess(
  input: {
    email: string;
    decision: AccessDecision;
    decidedBy: string;
    linkBase: string;
    role?: "requester" | "teacher";
    grade?: string;
    stipend?: string;
  },
  deps: AccessDeps,
): Promise<UserRecord> {
  const email = input.email.trim().toLowerCase();
  const now = (deps.now ?? (() => new Date()))();
  const existing = await deps.users.get(email);
  const base: UserRecord = existing ?? {
    email,
    role: "requester",
    status: "pending",
    requested_at: now.toISOString(),
    approved_at: "",
    approved_by: "",
    last_link_at: "",
    note: "",
    grade: "",
    stipend: "",
  };

  if (input.decision === "deny") {
    const denied: UserRecord = { ...base, status: "denied", approved_at: now.toISOString(), approved_by: input.decidedBy };
    await deps.users.upsert(denied);
    return denied;
  }

  const role = base.role === "ap" || base.role === "admin" ? base.role : (input.role ?? base.role);
  const grade = input.grade ?? base.grade;
  const stipend = input.stipend ?? base.stipend;
  if (existing?.status === "approved" && same(existing.email, email)) {
    // idempotent: a second click sends nothing, but may still change role, grade or stipend
    if (role === existing.role && grade === existing.grade && stipend === existing.stipend) return existing;
    const updated: UserRecord = { ...existing, role, grade, stipend };
    await deps.users.upsert(updated);
    return updated;
  }
  const approved: UserRecord = { ...base, status: "approved", approved_at: now.toISOString(), approved_by: input.decidedBy, last_link_at: now.toISOString(), role, grade, stipend };
  await deps.users.upsert(approved);
  const mail = approvedEmail(signInLink(input.linkBase, await createMagicToken(email)));
  await deps.mailer.send({ to: [email], subject: mail.subject, text: mail.text });
  return approved;
}
