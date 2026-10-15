import { beforeEach, describe, expect, it } from "vitest";
import { decideAccess, requestSignIn } from "@/server/auth/access";
import { verifyApprovalToken, verifyMagicToken } from "@/server/auth/tokens";
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
    expect(users.rows[0]).toMatchObject({ email: "new.teacher@example.org", status: "pending", role: "requester" });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toEqual(["ap@miralomasf.com"]);
    expect(mailer.sent[0].subject).toContain("new.teacher@example.org");
    expect(await verifyApprovalToken(tokenIn(mailer.sent[0].text))).toBe("new.teacher@example.org");
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
    await users.upsert({ email: "ok@example.org", role: "requester", status: "approved", requested_at: "", approved_at: "", approved_by: "", last_link_at: "", note: "" });
    expect(await requestSignIn({ email: "ok@example.org", linkBase: BASE, next: "/requests" }, deps())).toBe("sent");
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toEqual(["ok@example.org"]);
    const link = new URL(mailer.sent[0].text.match(/https?:\/\/\S+/)![0]);
    expect(link.pathname).toBe("/auth/callback");
    expect(link.searchParams.get("next")).toBe("/requests");
    expect(await verifyMagicToken(link.searchParams.get("token")!)).toBe("ok@example.org");

    clock = new Date(clock.getTime() + 30_000);
    expect(await requestSignIn({ email: "ok@example.org", linkBase: BASE }, deps())).toBe("sent");
    expect(mailer.sent).toHaveLength(1); // cooldown: nothing new

    clock = new Date(clock.getTime() + 60_000);
    await requestSignIn({ email: "ok@example.org", linkBase: BASE }, deps());
    expect(mailer.sent).toHaveLength(2);
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

describe("decideAccess", () => {
  it("approving marks the row and emails the requester a sign-in link, once", async () => {
    const users = new MemoryUsers();
    const mailer = new MemoryMailer();
    await requestSignIn({ email: "t@example.org", linkBase: BASE }, { users, mailer });
    const record = await decideAccess({ email: "t@example.org", decision: "approve", decidedBy: "link", linkBase: BASE }, { users, mailer });
    expect(record.status).toBe("approved");
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[1].to).toEqual(["t@example.org"]);
    expect(await verifyMagicToken(tokenIn(mailer.sent[1].text))).toBe("t@example.org");
    await decideAccess({ email: "t@example.org", decision: "approve", decidedBy: "link", linkBase: BASE }, { users, mailer });
    expect(mailer.sent).toHaveLength(2); // second click is a no-op
  });

  it("approving an address with no row creates it", async () => {
    const users = new MemoryUsers();
    const mailer = new MemoryMailer();
    const record = await decideAccess({ email: "Fresh@example.org", decision: "approve", decidedBy: "link", linkBase: BASE }, { users, mailer });
    expect(record).toMatchObject({ email: "fresh@example.org", status: "approved", role: "requester" });
    expect(users.rows).toHaveLength(1);
  });
});
