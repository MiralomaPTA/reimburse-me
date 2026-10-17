import { beforeEach, describe, expect, it } from "vitest";
import { approvalLinkIsStale, completeSignIn, decideAccess, requestSignIn } from "@/server/auth/access";
import { createMagicToken, verifyApprovalToken, verifyMagicToken } from "@/server/auth/tokens";
import type { MailMessage, Mailer, UserDirectory, UserRecord } from "@/server/adapters/types";

class MemoryUsers implements UserDirectory {
  rows: UserRecord[] = [];
  async get(email: string) {
    return this.rows.find((r) => r.email === email.toLowerCase()) ?? null;
  }
  async upsert(record: UserRecord) {
    const i = this.rows.findIndex((r) => r.email === record.email);
    if (i === -1) this.rows.push(record);
    else this.rows[i] = record;
  }
  async countPendingSince(since: string) {
    return this.rows.filter((r) => r.status === "pending" && r.requested_at >= since).length;
  }
}

class MemoryMailer implements Mailer {
  sent: MailMessage[] = [];
  async send(message: MailMessage) {
    this.sent.push(message);
  }
}

const BASE = "http://localhost:3000";
const tokenIn = (text: string, param = "token") => new URL(text.match(/https?:\/\/\S+/)![0]).searchParams.get(param)!;
const row = (email: string, extra: Partial<UserRecord> = {}): UserRecord => ({
  email,
  role: "requester",
  status: "approved",
  requested_at: "",
  approved_at: "",
  approved_by: "",
  last_link_at: "",
  signed_in_at: "",
  note: "",
  grade: "",
  stipend: "",
  ...extra,
});

describe("requestSignIn", () => {
  let users: MemoryUsers;
  let mailer: MemoryMailer;
  let clock: Date;
  const deps = () => ({ users, mailer, now: () => clock });

  beforeEach(() => {
    users = new MemoryUsers();
    mailer = new MemoryMailer();
    clock = new Date("2026-10-14T20:00:00Z");
  });

  it("asks the approver about an unknown address and emails the address nothing", async () => {
    const outcome = await requestSignIn({ email: "New.Teacher@example.org", linkBase: BASE }, deps());
    expect(outcome).toBe("pending");
    expect(users.rows).toHaveLength(1);
    expect(users.rows[0]).toMatchObject({ email: "new.teacher@example.org", status: "pending", role: "requester", signed_in_at: "" });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toEqual(["ap@miralomasf.com"]);
    expect(mailer.sent[0].subject).toContain("new.teacher@example.org");
    expect((await verifyApprovalToken(tokenIn(mailer.sent[0].text)))?.email).toBe("new.teacher@example.org");
  });

  it("sends nothing more for a pending or denied address", async () => {
    await requestSignIn({ email: "a@example.net", linkBase: BASE }, deps());
    await requestSignIn({ email: "a@example.net", linkBase: BASE }, deps());
    expect(mailer.sent).toHaveLength(1);
    await decideAccess({ email: "a@example.net", decision: "deny", decidedBy: "test", linkBase: BASE }, deps());
    expect(await requestSignIn({ email: "a@example.net", linkBase: BASE }, deps())).toBe("pending");
    expect(mailer.sent).toHaveLength(1);
  });

  it("emails an approved address a sign-in link, at most once a minute", async () => {
    await users.upsert(row("ok@example.org"));
    expect(await requestSignIn({ email: "ok@example.org", linkBase: BASE, next: "/requests" }, deps())).toBe("sent");
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toEqual(["ok@example.org"]);
    const link = new URL(mailer.sent[0].text.match(/https?:\/\/\S+/)![0]);
    expect(link.pathname).toBe("/auth/callback");
    expect(link.searchParams.get("next")).toBe("/requests");
    expect((await verifyMagicToken(link.searchParams.get("token")!))?.email).toBe("ok@example.org");

    clock = new Date(clock.getTime() + 30_000);
    expect(await requestSignIn({ email: "ok@example.org", linkBase: BASE }, deps())).toBe("sent");
    expect(mailer.sent).toHaveLength(1); // cooldown: nothing new

    clock = new Date(clock.getTime() + 60_000);
    await requestSignIn({ email: "ok@example.org", linkBase: BASE }, deps());
    expect(mailer.sent).toHaveLength(2);
  });

  it("never puts an off-site return path in the link", async () => {
    await users.upsert(row("ok@example.org"));
    await requestSignIn({ email: "ok@example.org", linkBase: BASE, next: "//evil.com" }, deps());
    const link = new URL(mailer.sent[0].text.match(/https?:\/\/\S+/)![0]);
    expect(link.searchParams.has("next")).toBe(false);
  });

  it("stops recording new pending addresses past the daily cap", async () => {
    for (let i = 0; i < 20; i++) await requestSignIn({ email: `spam${i}@example.net`, linkBase: BASE }, deps());
    expect(mailer.sent).toHaveLength(20);
    expect(await requestSignIn({ email: "spam20@example.net", linkBase: BASE }, deps())).toBe("pending");
    expect(users.rows).toHaveLength(20);
    expect(mailer.sent).toHaveLength(20);
    // a day later the window has moved on
    clock = new Date(clock.getTime() + 25 * 60 * 60 * 1000);
    await requestSignIn({ email: "later@example.net", linkBase: BASE }, deps());
    expect(users.rows).toHaveLength(21);
  });
});

describe("completeSignIn", () => {
  let users: MemoryUsers;
  let mailer: MemoryMailer;
  let clock: Date;
  const deps = () => ({ users, mailer, now: () => clock });

  beforeEach(() => {
    users = new MemoryUsers();
    mailer = new MemoryMailer();
    // Tokens carry the real time they were made, so the clock has to be real too.
    clock = new Date(Date.now() + 1000);
  });

  it("signs an approved address in, and refuses the same link a second time", async () => {
    await users.upsert(row("ok@example.org"));
    const token = await createMagicToken("ok@example.org");
    expect(await completeSignIn(token, deps())).toEqual({ ok: true, email: "ok@example.org" });
    expect(users.rows[0].signed_in_at).toBe(clock.toISOString());
    clock = new Date(clock.getTime() + 1000);
    expect(await completeSignIn(token, deps())).toEqual({ ok: false, reason: "used" });
  });

  it("refuses a link for an address that is no longer approved", async () => {
    await users.upsert(row("gone@example.org"));
    const token = await createMagicToken("gone@example.org");
    await users.upsert(row("gone@example.org", { status: "denied" }));
    expect(await completeSignIn(token, deps())).toEqual({ ok: false, reason: "not-approved" });
    expect(await completeSignIn(await createMagicToken("nobody@example.org"), deps())).toEqual({ ok: false, reason: "not-approved" });
  });

  it("refuses anything that isn't a sign-in token", async () => {
    expect(await completeSignIn("nonsense", deps())).toEqual({ ok: false, reason: "invalid" });
    await requestSignIn({ email: "new@example.org", linkBase: BASE }, deps());
    expect(await completeSignIn(tokenIn(mailer.sent[0].text), deps())).toEqual({ ok: false, reason: "invalid" }); // an approval token
  });
});

describe("decideAccess", () => {
  it("approving marks the row and emails the requester a sign-in link, once", async () => {
    const users = new MemoryUsers();
    const mailer = new MemoryMailer();
    await requestSignIn({ email: "t@example.org", linkBase: BASE }, { users, mailer });
    const { outcome, record } = await decideAccess({ email: "t@example.org", decision: "approve", decidedBy: "link", linkBase: BASE }, { users, mailer });
    expect(outcome).toBe("approved");
    expect(record.status).toBe("approved");
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[1].to).toEqual(["t@example.org"]);
    expect((await verifyMagicToken(tokenIn(mailer.sent[1].text)))?.email).toBe("t@example.org");
    const again = await decideAccess({ email: "t@example.org", decision: "approve", decidedBy: "link", linkBase: BASE }, { users, mailer });
    expect(again.outcome).toBe("unchanged");
    expect(mailer.sent).toHaveLength(2); // second click is a no-op
  });

  it("approving an address with no row creates it", async () => {
    const users = new MemoryUsers();
    const mailer = new MemoryMailer();
    const { record } = await decideAccess({ email: "Fresh@example.org", decision: "approve", decidedBy: "link", linkBase: BASE }, { users, mailer });
    expect(record).toMatchObject({ email: "fresh@example.org", status: "approved", role: "requester" });
    expect(users.rows).toHaveLength(1);
  });

  it("sets role, grade and stipend on approval; a decision made by hand can still be adjusted without another email", async () => {
    const users = new MemoryUsers();
    const mailer = new MemoryMailer();
    await requestSignIn({ email: "b@example.org", linkBase: BASE }, { users, mailer });
    await decideAccess({ email: "b@example.org", decision: "approve", decidedBy: "link", linkBase: BASE, role: "teacher", grade: "2", stipend: "" }, { users, mailer });
    expect(users.rows[0]).toMatchObject({ status: "approved", role: "teacher", grade: "2", stipend: "" });
    expect(mailer.sent).toHaveLength(2);
    const { outcome } = await decideAccess({ email: "b@example.org", decision: "approve", decidedBy: "link", linkBase: BASE, role: "requester", grade: "", stipend: "150.00" }, { users, mailer });
    expect(outcome).toBe("updated");
    expect(users.rows[0]).toMatchObject({ role: "requester", grade: "", stipend: "150.00" });
    expect(mailer.sent).toHaveLength(2);
  });

  it("does nothing with a link made before the row's decision, so a denied address can't be re-approved", async () => {
    const users = new MemoryUsers();
    const mailer = new MemoryMailer();
    let clock = new Date("2026-10-14T20:00:00Z");
    const deps = { users, mailer, now: () => clock };
    await requestSignIn({ email: "d@example.org", linkBase: BASE }, deps);
    const issuedAt = clock;
    clock = new Date(clock.getTime() + 60_000);
    await decideAccess({ email: "d@example.org", decision: "deny", decidedBy: "link", linkBase: BASE, issuedAt }, deps);
    expect(users.rows[0].status).toBe("denied");

    clock = new Date(clock.getTime() + 60_000);
    const stale = await decideAccess({ email: "d@example.org", decision: "approve", decidedBy: "link", linkBase: BASE, issuedAt }, deps);
    expect(stale.outcome).toBe("already-decided");
    expect(users.rows[0].status).toBe("denied");
    expect(mailer.sent).toHaveLength(1); // only the original approval request

    // A link made after the decision (a fresh approval email) still works.
    const fresh = await decideAccess({ email: "d@example.org", decision: "approve", decidedBy: "link", linkBase: BASE, issuedAt: clock }, deps);
    expect(fresh.outcome).toBe("approved");
    expect(mailer.sent).toHaveLength(2);
  });

  it("never changes an AP or admin role from the approval page", async () => {
    const users = new MemoryUsers();
    const mailer = new MemoryMailer();
    await users.upsert(row("ap@example.org", { role: "ap", status: "pending" }));
    await decideAccess({ email: "ap@example.org", decision: "approve", decidedBy: "link", linkBase: BASE, role: "teacher" }, { users, mailer });
    expect(users.rows[0]).toMatchObject({ status: "approved", role: "ap" });
  });

  it("keeps a role, grade and stipend preloaded in the Sheet when the approval doesn't give them", async () => {
    const users = new MemoryUsers();
    const mailer = new MemoryMailer();
    await users.upsert(row("p@example.org", { role: "teacher", status: "pending", grade: "K", stipend: "300" }));
    await decideAccess({ email: "p@example.org", decision: "approve", decidedBy: "link", linkBase: BASE }, { users, mailer });
    expect(users.rows[0]).toMatchObject({ status: "approved", role: "teacher", grade: "K", stipend: "300" });
  });
});

describe("approvalLinkIsStale", () => {
  it("is stale only once a decision is on the row and the link predates it", () => {
    const issuedAt = new Date("2026-10-14T20:00:00Z");
    expect(approvalLinkIsStale(issuedAt, { approved_at: "" })).toBe(false);
    expect(approvalLinkIsStale(issuedAt, { approved_at: "not a date" })).toBe(false);
    expect(approvalLinkIsStale(issuedAt, { approved_at: "2026-10-14T19:59:00.000Z" })).toBe(false);
    expect(approvalLinkIsStale(issuedAt, { approved_at: "2026-10-14T20:01:00.000Z" })).toBe(true);
  });
});
