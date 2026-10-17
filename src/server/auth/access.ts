import type { Mailer, UserDirectory, UserRecord } from "@/server/adapters/types";
import { createApprovalToken, createMagicToken, verifyMagicToken } from "@/server/auth/tokens";
import { config } from "@/server/config";
import { approvalRequestEmail, approvedEmail, signInEmail } from "@/server/email/templates";
import { safeNextPath } from "@/lib/next-path";

/**
 * Who may sign in, and what happens when someone asks for a link.
 *
 * - Approved address: email a sign-in link (at most one a minute, durably).
 *   The link works once: using it records `signed_in_at` on the row, and any
 *   link issued before that time is refused.
 * - Unknown address: add a pending row and ask the approver once. Nothing is
 *   ever emailed to the unknown address itself, so the form can't be used to
 *   spam strangers. Repeat requests send nothing more.
 * - Pending or denied address: nothing is sent.
 * - The approval link works until a decision is on the row. After that it
 *   does nothing, so a forwarded or re-clicked email can't re-approve an
 *   address that was denied.
 *
 * `deps` is injectable for tests.
 */

export interface AccessDeps {
  users: UserDirectory;
  mailer: Mailer;
  now?: () => Date;
}

export type SignInOutcome = "sent" | "pending";

const clock = (deps: AccessDeps) => (deps.now ?? (() => new Date()))();

function signInLink(base: string, token: string, next?: string): string {
  const url = new URL("/auth/callback", base);
  url.searchParams.set("token", token);
  const path = safeNextPath(next);
  if (path) url.searchParams.set("next", path);
  return url.toString();
}

function newRecord(email: string, now: Date): UserRecord {
  return {
    email,
    role: "requester",
    status: "pending",
    requested_at: now.toISOString(),
    approved_at: "",
    approved_by: "",
    last_link_at: "",
    signed_in_at: "",
    note: "",
    grade: "",
    stipend: "",
  };
}

export async function requestSignIn(input: { email: string; linkBase: string; next?: string }, deps: AccessDeps): Promise<SignInOutcome> {
  const email = input.email.trim().toLowerCase();
  const now = clock(deps);
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
  await deps.users.upsert(newRecord(email, now));
  const url = new URL("/auth/approve", input.linkBase);
  url.searchParams.set("token", await createApprovalToken(email));
  const mail = approvalRequestEmail({ email, requestedAt: now, approveUrl: url.toString() });
  await deps.mailer.send({ to: [config.approverEmail], subject: mail.subject, text: mail.text });
  return "pending";
}

/** Why a clicked sign-in link was refused. */
export type SignInFailure = "invalid" | "used" | "not-approved";
export type SignInCompletion = { ok: true; email: string } | { ok: false; reason: SignInFailure };

/**
 * Turns a clicked sign-in link into a signed-in address. The row must still
 * be approved, and the link must be newer than the row's last sign-in: that
 * is what makes each link work once.
 */
export async function completeSignIn(token: string, deps: AccessDeps): Promise<SignInCompletion> {
  const verified = await verifyMagicToken(token);
  if (!verified) return { ok: false, reason: "invalid" };
  const record = await deps.users.get(verified.email);
  if (record?.status !== "approved") return { ok: false, reason: "not-approved" };
  const lastSignIn = record.signed_in_at ? Date.parse(record.signed_in_at) : 0;
  if (verified.issuedAt.getTime() < lastSignIn) return { ok: false, reason: "used" };
  await deps.users.upsert({ ...record, signed_in_at: clock(deps).toISOString() });
  return { ok: true, email: record.email };
}

export type AccessDecision = "approve" | "deny";
export type AccessOutcome = "approved" | "denied" | "updated" | "unchanged" | "already-decided";
export interface AccessResult {
  outcome: AccessOutcome;
  record: UserRecord;
}

/** An approval link made before the row's last decision does nothing. */
export function approvalLinkIsStale(issuedAt: Date, record: Pick<UserRecord, "approved_at">): boolean {
  const decidedAt = record.approved_at ? Date.parse(record.approved_at) : NaN;
  return Number.isFinite(decidedAt) && issuedAt.getTime() < decidedAt;
}

/**
 * Applies the approver's decision. Approving emails the requester a sign-in
 * link; denying stays silent. `role`, `grade` and `stipend`, when given,
 * replace the row's values on approval ("" clears them); left out, the row's
 * are kept, so values preloaded in the Sheet survive. An AP or admin row keeps
 * its role: the approval page only chooses between teacher and staff.
 * `issuedAt` is when the link was made; a link older than the row's decision
 * is refused.
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
    issuedAt?: Date;
  },
  deps: AccessDeps,
): Promise<AccessResult> {
  const email = input.email.trim().toLowerCase();
  const now = clock(deps);
  const existing = await deps.users.get(email);
  if (existing && input.issuedAt && approvalLinkIsStale(input.issuedAt, existing)) return { outcome: "already-decided", record: existing };
  const base = existing ?? newRecord(email, now);

  if (input.decision === "deny") {
    const denied: UserRecord = { ...base, status: "denied", approved_at: now.toISOString(), approved_by: input.decidedBy };
    await deps.users.upsert(denied);
    return { outcome: "denied", record: denied };
  }

  const role = base.role === "ap" || base.role === "admin" ? base.role : (input.role ?? base.role);
  const grade = input.grade ?? base.grade;
  const stipend = input.stipend ?? base.stipend;
  if (existing?.status === "approved") {
    // Already approved (preloaded, or by hand): no email, but role, grade or stipend may still change.
    if (role === existing.role && grade === existing.grade && stipend === existing.stipend) return { outcome: "unchanged", record: existing };
    const updated: UserRecord = { ...existing, role, grade, stipend };
    await deps.users.upsert(updated);
    return { outcome: "updated", record: updated };
  }
  const approved: UserRecord = { ...base, status: "approved", approved_at: now.toISOString(), approved_by: input.decidedBy, last_link_at: now.toISOString(), role, grade, stipend };
  await deps.users.upsert(approved);
  const mail = approvedEmail(signInLink(input.linkBase, await createMagicToken(email)));
  await deps.mailer.send({ to: [email], subject: mail.subject, text: mail.text });
  return { outcome: "approved", record: approved };
}
