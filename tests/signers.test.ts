import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { EventRow, MailMessage, UserRecord } from "@/server/adapters/types";
import { config, parseBillPayAccounts, parseCheckSigners } from "@/server/config";
import { createSignerToken } from "@/server/auth/tokens";
import { signAsChair } from "@/server/requests/chair";
import { lockTiming } from "@/server/requests/lock";
import { MailingError, mailingRefusal } from "@/server/requests/mailing";
import { profileFrom } from "@/server/requests/profile";
import { sendPacketOn } from "@/server/requests/send-on";
import {
  AUTHORIZED_SENDING_MS,
  AuthorizedResendError,
  authorizedSending,
  budgetAccountDefault,
  resendToSigners,
  sendBackAsSigner,
  SignerError,
  SignerResendError,
  signerFlags,
  signerLinkState,
  signerPdf,
  signAsSigner,
  sendAuthorizedAgain,
} from "@/server/requests/signers";
import { submitRequest } from "@/server/requests/submit";
import { requestInputSchema } from "@/lib/request-schema";
import { jpeg, ME, request, session, teacher, world } from "./support";

const COIT = "coit@example.org";
const NORTON = "norton@example.org";
const ALIOTO = "alioto@example.org";
const ACCOUNTS = ["Bill pay checking ••1234", "Reserve ••9876"];
const ADDRESS = { address: "123 Main St Apt 4", cityStateZip: "San Francisco, CA 94127" };
const mailer: UserRecord = { ...teacher, mailed_checks: "yes" };

/** The request ID and token in a check signer's email. */
function linkIn(mail: MailMessage): { requestId: string; token: string } {
  const match = mail.text.match(/\/signers\/([^?\s]+)\?t=(\S+)/);
  if (!match) throw new Error(`no signer link in: ${mail.text}`);
  return { requestId: decodeURIComponent(match[1]), token: decodeURIComponent(match[2]) };
}

const mailed = (fileIds: string[], funding: string | string[] = "none", event = "") => ({ ...request(fileIds, funding, 0, event), checkDelivery: "mail" as const, ...ADDRESS });

async function setup(opts: { user?: UserRecord; events?: EventRow[]; funding?: string | string[]; event?: string } = {}) {
  const w = world();
  const user = opts.user ?? mailer;
  w.eventRows.push(...(opts.events ?? []));
  w.files.add("r1", user.email, await jpeg());
  const submit = (input = mailed(["r1"], opts.funding ?? "grade:2", opts.event ?? "")) =>
    submitRequest({ request: input, signature: { type: "typed", name: "Pat Teacher" }, session: session(user), ip: "127.0.0.1", userAgent: "vitest", linkBase: "https://portal.example" }, w.adapters);
  const sign = (link: { requestId: string; token: string }, name: string, extra: Partial<Parameters<typeof signAsSigner>[0]> = {}) =>
    signAsSigner(
      {
        ...link,
        slot: 1,
        version: 1,
        name,
        signature: { type: "typed", name },
        note: "",
        budgetAccount: "Grade 2 stipend",
        paymentAccount: ACCOUNTS[0],
        ip: "10.0.0.9",
        userAgent: "vitest",
        linkBase: "https://portal.example",
        ...extra,
      },
      w.adapters,
    );
  return { ...w, submit, sign };
}

describe("mailed checks", () => {
  const saved = { ...config };
  const settle = lockTiming.settleMs;
  beforeEach(() => {
    config.checkSigners = [COIT, NORTON, ALIOTO];
    config.billPayAccounts = [...ACCOUNTS];
    config.mailedChecks = "pilot";
    // The default, which mailed checks must ignore: they always go straight to AP.
    config.sendPacketsTo = "requester";
    lockTiming.settleMs = 0;
  });
  afterEach(() => {
    Object.assign(config, saved);
    lockTiming.settleMs = settle;
  });

  describe("who is offered mailing", () => {
    it("follows the account's mailed_checks cell, MAILED_CHECKS and the signer settings", () => {
      expect(mailingRefusal({ email: ME, mailed_checks: "" })).toBe("not-switched-on");
      expect(mailingRefusal({ email: ME, mailed_checks: " YES " })).toBeNull();
      expect(mailingRefusal({ email: ME, mailed_checks: "no" })).toBe("not-switched-on");
      config.mailedChecks = "everyone";
      expect(mailingRefusal({ email: ME, mailed_checks: "" })).toBeNull();
      expect(mailingRefusal({ email: ME, mailed_checks: "maybe" })).toBeNull();
      expect(mailingRefusal({ email: ME, mailed_checks: "No" })).toBe("not-switched-on");
      config.mailedChecks = "off";
      expect(mailingRefusal({ email: ME, mailed_checks: "yes" })).toBe("off");
      config.mailedChecks = "pilot";
      config.billPayAccounts = [];
      expect(mailingRefusal({ email: ME, mailed_checks: "yes" })).toBe("not-set-up");
      config.billPayAccounts = [...ACCOUNTS];
      // A check signer needs two others to sign for them.
      config.checkSigners = [COIT, NORTON];
      expect(mailingRefusal({ email: COIT, mailed_checks: "yes" })).toBe("too-few-signers");
      expect(mailingRefusal({ email: ME, mailed_checks: "yes" })).toBeNull();
    });

    it("refuses bad CHECK_SIGNERS and BILL_PAY_ACCOUNTS rather than starting with them", () => {
      expect(parseCheckSigners(" Coit@Example.org, norton@example.org ,", ["ap@x.org"])).toEqual([COIT, NORTON]);
      expect(parseCheckSigners(undefined, [])).toEqual([]);
      expect(() => parseCheckSigners("coit@example.org, Lillie Coit", [])).toThrow("isn't an email address");
      expect(() => parseCheckSigners("coit@example.org, COIT@example.org", [])).toThrow("twice");
      expect(() => parseCheckSigners("coit@example.org, ap@miralomasf.com", ["AP@miralomasf.com"])).toThrow("shared mailbox");
      expect(parseBillPayAccounts("Bill pay checking ••1234, Reserve 9876")).toEqual(["Bill pay checking ••1234", "Reserve 9876"]);
      expect(() => parseBillPayAccounts("Checking 123456789")).toThrow("full account number");
    });

    it("refuses a mailed request from an account mailing isn't switched on for, reading the row at signing", async () => {
      const { submit, log, mailer: mail } = await setup({ user: { ...teacher, mailed_checks: "" } });
      await expect(submit()).rejects.toBeInstanceOf(MailingError);
      expect(log.rows).toEqual([]);
      expect(mail.sent).toEqual([]);
    });
  });

  describe("the address", () => {
    const base = request(["receipt-1"]);
    it("is required, one plain line each, and must end in a ZIP", () => {
      expect(requestInputSchema.safeParse({ ...base, checkDelivery: "mail" }).success).toBe(false);
      const ok = requestInputSchema.parse({ ...base, checkDelivery: "mail", address: "  123  Main St ", cityStateZip: "San Francisco, CA 94127-1234" });
      expect(ok).toMatchObject({ address: "123 Main St", cityStateZip: "San Francisco, CA 94127-1234" });
      const issues = (input: object) => requestInputSchema.safeParse({ ...base, checkDelivery: "mail", ...ADDRESS, ...input }).error?.issues.map((i) => i.message) ?? [];
      expect(issues({ address: "1234 Extraordinarily Long Boulevard Name Apt 5" })[0]).toContain("40 characters");
      expect(issues({ address: "123 Main St ☃" })[0]).toContain("Use only letters");
      expect(issues({ cityStateZip: "San Francisco, CA" })[0]).toContain("ZIP");
    });

    it("is dropped from a request that isn't mailed", () => {
      expect(requestInputSchema.parse({ ...base, checkDelivery: "pickup", ...ADDRESS })).toMatchObject({ address: "", cityStateZip: "" });
    });

    it("is filled in for next time from the last mailed request, even when the last request wasn't mailed", () => {
      const row = (id: string, at: string, delivery: "mail" | "mailbox", address = "", city_zip = "") =>
        ({ request_id: id, submitted_at: at, check_delivery: delivery, address, city_zip, payee_name: "Pat", pta_position: "Teacher", phone: "1" }) as never;
      const rows = [row("A", "2026-09-01", "mail", "1 Old Rd", "SF, CA 94110"), row("B", "2026-10-01", "mail", "9 New St", "SF, CA 94127"), row("C", "2026-11-01", "mailbox")];
      expect(profileFrom(rows, true)).toMatchObject({ checkDelivery: "mailbox", address: "9 New St", cityStateZip: "SF, CA 94127" });
      expect(profileFrom(rows.slice(0, 2), true)?.checkDelivery).toBe("mail");
      // While mailing is off for the account, a mailed last request starts on pickup, as before.
      expect(profileFrom(rows.slice(0, 2), false)?.checkDelivery).toBe("pickup");
    });
  });

  it("sends a mailed request to every check signer, each with their own link, and nothing to AP", async () => {
    const { submit, log, mailer: mail, files } = await setup();
    const result = await submit();
    expect(result.signers).toEqual({ reached: 3, notReached: 0 });
    const row = log.rows[0];
    expect(row).toMatchObject({ status: "Awaiting signers", signers_step: "Waiting", check_delivery: "mail", address: ADDRESS.address, city_zip: ADDRESS.cityStateZip });
    expect(row.signers_sent_to).toBe(`${COIT}, ${NORTON}, ${ALIOTO}`);
    expect(mail.to(config.apEmail)).toEqual([]);

    const [toCoit] = mail.to(COIT);
    expect(toCoit.subject).toBe(`Please authorize: mailed check to Pat Teacher, $10.00 (${result.requestId})`);
    // Not the requester: a reply quotes the link.
    expect(toCoit.replyTo).toBe(config.apEmail);
    expect(toCoit.text).toContain("Mail the check to: 123 Main St Apt 4, San Francisco, CA 94127");
    expect(toCoit.text).toContain("Budget Account: Grade 2 stipend");
    expect(toCoit.text).toContain(`Payment Account: ${ACCOUNTS[0]}`);
    expect(toCoit.text).toContain("This is the first mailed request from this account.");
    expect(toCoit.text).not.toContain("Paid from");
    expect(toCoit.attachments?.map((a) => a.filename)).toEqual([`${result.requestId}.pdf`, `${result.requestId}-fo10.pdf`]);
    expect(linkIn(toCoit).token).not.toBe(linkIn(mail.to(NORTON)[0]).token);

    const [toMe] = mail.to(ME);
    expect(toMe.subject).toContain("is with the PTA's check signers");
    expect(toMe.text).toContain("The PTA's bank then mails your check to 123 Main St Apt 4, San Francisco, CA 94127.");
    expect(toMe.attachments?.[0].filename).toBe(`${result.requestId}.pdf`);

    // The FO10 is filled from the request; one page, flattened.
    const fo10 = await PDFDocument.load(toCoit.attachments![1].bytes);
    expect(fo10.getPageCount()).toBe(1);
    expect(fo10.getForm().getFields()).toEqual([]);
    // The stored request carries the address; the packet's form doesn't need it.
    expect(files.files.get(row.request_file_id)!.bytes.length).toBeGreaterThan(0);
  }, 30_000);

  it("never emails a check signer their own request, and never lets them sign it", async () => {
    const { submit, mailer: mail, adapters } = await setup({ user: { ...mailer, email: ALIOTO } });
    const result = await submit();
    expect(result.signers).toEqual({ reached: 2, notReached: 0 });
    expect(mail.to(ALIOTO).map((m) => m.subject)).toEqual([expect.stringContaining("is with the PTA's check signers")]);
    const forged = await createSignerToken(ALIOTO, result.requestId, 1);
    const state = await signerLinkState(result.requestId, forged, adapters);
    expect(state.kind).toBe("not-signer");
  }, 30_000);
});

describe("the check signers' step", () => {
  const saved = { ...config };
  const settle = lockTiming.settleMs;
  beforeEach(() => {
    config.checkSigners = [COIT, NORTON, ALIOTO];
    config.billPayAccounts = [...ACCOUNTS];
    config.mailedChecks = "pilot";
    config.sendPacketsTo = "requester";
    lockTiming.settleMs = 0;
  });
  afterEach(() => {
    Object.assign(config, saved);
    lockTiming.settleMs = settle;
  });

  async function submitted(opts: Parameters<typeof setup>[0] = {}) {
    const w = await setup(opts);
    const result = await w.submit();
    const links = { coit: linkIn(w.mailer.to(COIT)[0]), norton: linkIn(w.mailer.to(NORTON)[0]), alioto: linkIn(w.mailer.to(ALIOTO)[0]) };
    w.mailer.sent = [];
    return { ...w, requestId: result.requestId, links };
  }

  it("the first signature saves the FO10 with it, locks the accounts, and asks the others for one more", async () => {
    const { sign, links, log, mailer: mail, files, signatures, requestId, adapters } = await submitted();
    const result = await sign(links.coit, "Lillie Coit", { budgetAccount: "Grade 2 stipend (art)", paymentAccount: ACCOUNTS[1], note: "Looks right" });
    expect(result).toMatchObject({ slot: 1, emailed: true, receipted: true });
    const row = log.rows[0];
    expect(row).toMatchObject({
      status: "Awaiting signers",
      signers_step: "1 of 2 signed",
      signer_1_email: COIT,
      signer_1_name: "Lillie Coit",
      signer_1_note: "Looks right",
      budget_account: "Grade 2 stipend (art)",
      payment_account: ACCOUNTS[1],
      signers_sent_to: `${NORTON}, ${ALIOTO}`,
    });
    expect(files.files.get(row.fo10_file_id)!.name).toBe(`${requestId}-fo10-1.pdf`);
    expect(signatures.records).toEqual([
      expect.objectContaining({ slot: 1, state: "signed", signer_email: COIT, ip: "10.0.0.9", browser: "vitest", budget_account: "Grade 2 stipend (art)", payment_account: ACCOUNTS[1], fo10_sha256: row.fo10_sha256 }),
    ]);

    expect(mail.to(config.apEmail)).toEqual([]);
    expect(mail.to(COIT).map((m) => m.subject)).toEqual([`You signed: mailed check to Pat Teacher, $10.00 (${requestId})`]);
    expect(mail.to(COIT)[0].text).toContain(`If this wasn't you, tell the PTA at ${config.apEmail}`);
    const [toNorton] = mail.to(NORTON);
    expect(toNorton.subject).toBe(`One more signature: mailed check to Pat Teacher, $10.00 (${requestId})`);
    expect(toNorton.text).toContain("Lillie Coit signed the first Authorized By line");
    expect(toNorton.text).toContain("Budget Account: Grade 2 stipend (art)");

    // The first signer's link now only says they've signed; the second signature is someone else's.
    expect((await signerLinkState(requestId, links.coit.token, adapters)).kind).toBe("signed-first");
    await expect(sign(links.coit, "Lillie Coit", { slot: 2 })).rejects.toThrow("You've already signed this one");
    // The old link still works for the next signature.
    const state = await signerLinkState(requestId, links.norton.token, adapters);
    expect(state).toMatchObject({ kind: "ready", slot: 2, accounts: { locked: true, budgetAccount: "Grade 2 stipend (art)" } });
  }, 30_000);

  it("the second signature builds the authorized packet and sends it straight to AP, whatever SEND_PACKETS_TO says", async () => {
    const { sign, links, log, mailer: mail, files, requestId, adapters } = await submitted();
    await sign(links.coit, "Lillie Coit", { note: "First" });
    mail.sent = [];
    // The second signer's budget and account are ignored: they're locked.
    const result = await sign(links.alioto, "Joseph Alioto", { slot: 2, budgetAccount: "Something else", paymentAccount: ACCOUNTS[1], note: "Second" });
    expect(result).toMatchObject({ slot: 2, emailed: true, receipted: true });
    const row = log.rows[0];
    expect(row).toMatchObject({ status: "Submitted", signers_step: "Signed", signer_2_email: ALIOTO, budget_account: "Grade 2 stipend", payment_account: ACCOUNTS[0] });
    expect(result.sha256).toBe(row.authorized_pdf_sha256);
    const authorized = files.files.get(row.authorized_pdf_file_id)!;
    expect(authorized.name).toBe(`${requestId}-authorized.pdf`);
    const packet = await PDFDocument.load(files.files.get(row.pdf_file_id)!.bytes);
    // The FO10, every page of the packet, and the authorization page.
    expect((await PDFDocument.load(authorized.bytes)).getPageCount()).toBe(packet.getPageCount() + 2);

    const [toAp] = mail.to(config.apEmail);
    expect(toAp.subject).toContain("mailed check");
    expect(toAp.replyTo).toBe(ME);
    expect(toAp.text).toContain("Mail the check to: 123 Main St Apt 4, San Francisco, CA 94127");
    expect(toAp.text).toMatch(/Authorized by Lillie Coit \(\w+ \d+\) and Joseph Alioto \(\w+ \d+\)/);
    expect(toAp.text).toContain("Pay only to the address on the signed FO10. A change of address needs a new request.");
    expect(toAp.text).toContain("Lillie Coit's note: First");
    expect(toAp.text).toContain("This is the first mailed request from this account.");
    expect(toAp.text).toContain(`SHA-256: ${row.authorized_pdf_sha256}`);
    expect(toAp.attachments?.[0].filename).toBe(`${requestId}-authorized.pdf`);
    expect(mail.to(ME)[0].subject).toContain("approved for mailing");
    expect(mail.to(ALIOTO)[0].subject).toContain("You signed");

    // Every link now shows only a status line, and serves nothing.
    const done = await signerLinkState(requestId, links.norton.token, adapters);
    expect(done).toMatchObject({ kind: "done", status: expect.stringMatching(/^Authorized by Lillie Coit and Joseph Alioto on \w+ \d+\.$/) });
    expect(await signerPdf(requestId, links.norton.token, "packet", adapters)).toBeNull();
  }, 30_000);

  it("refuses a signature under the payee's own name", async () => {
    const { sign, links } = await submitted();
    await expect(sign(links.coit, "pat  teacher.")).rejects.toThrow("You can't authorize a payment to yourself.");
  }, 30_000);

  it("needs a Budget Account and a Payment Account from the list for the first signature", async () => {
    const { sign, links, signatures } = await submitted();
    await expect(sign(links.coit, "Lillie Coit", { budgetAccount: "  " })).rejects.toThrow("Enter the Budget Account");
    await expect(sign(links.coit, "Lillie Coit", { budgetAccount: "Grade 2 <b>" })).rejects.toThrow("Use only letters");
    await expect(sign(links.coit, "Lillie Coit", { paymentAccount: "Checking ••0000" })).rejects.toThrow("Choose the Payment Account");
    // Refused before anything is recorded.
    expect(signatures.records).toEqual([]);
  }, 30_000);

  it("lets only one of two signers pressing Sign at once make the first signature", async () => {
    const { sign, links, log, signatures, mailer: mail } = await submitted();
    const results = await Promise.allSettled([sign(links.coit, "Lillie Coit"), sign(links.norton, "Joshua Norton")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r): r is PromiseRejectedResult => r.status === "rejected")!.reason;
    expect(lost).toBeInstanceOf(SignerError);
    expect((lost as SignerError).reload).toBe(true);
    expect(log.rows[0]).toMatchObject({ signers_step: "1 of 2 signed", lock: "" });
    expect(signatures.records.map((r) => r.state)).toEqual(["signed"]);
    expect(mail.sent.filter((m) => m.subject.startsWith("You signed"))).toHaveLength(1);
  }, 30_000);

  it("waits for the row's lock, so a resend or another signer can't run halfway through a signature, and takes a lock left by a crash once it expires", async () => {
    const { sign, links, log, signatures } = await submitted();
    log.rows[0].lock = `${new Date(Date.now() + 60_000).toISOString()} resending`;
    await expect(sign(links.coit, "Lillie Coit")).rejects.toMatchObject({ message: expect.stringContaining("working on this request right now"), reload: true });
    expect(signatures.records).toEqual([]);
    log.rows[0].lock = `${new Date(Date.now() - 1000).toISOString()} crashed`;
    await expect(sign(links.coit, "Lillie Coit")).resolves.toMatchObject({ slot: 1 });
    expect(log.rows[0].lock).toBe("");
  }, 30_000);

  it("refuses to sign when the packet no longer matches what was signed", async () => {
    const { sign, links, log, files, signatures } = await submitted();
    files.files.get(log.rows[0].pdf_file_id)!.bytes = new Uint8Array([1, 2, 3]);
    await expect(sign(links.coit, "Lillie Coit")).rejects.toThrow("don't match the record");
    expect(log.rows[0]).toMatchObject({ signers_step: "Waiting", lock: "" });
    expect(signatures.records).toEqual([]);
  }, 30_000);

  it("leaves the row as it was when the signature can't be recorded", async () => {
    const { sign, links, log, signatures } = await submitted();
    signatures.failing = true;
    await expect(sign(links.coit, "Lillie Coit")).rejects.toThrow("Sheets refused");
    expect(log.rows[0]).toMatchObject({ signers_step: "Waiting", signer_1_email: "", lock: "" });
  }, 30_000);

  it("shows a link whose files don't match the record as such, rather than failing", async () => {
    const { links, log, requestId, adapters, sign } = await submitted();
    log.rows[0].pdf_sha256 = "edited in the Sheet";
    const state = await signerLinkState(requestId, links.coit.token, adapters);
    expect(state.kind).toBe("mismatch");
    await expect(sign(links.coit, "Lillie Coit")).rejects.toMatchObject({ message: expect.stringContaining("don't match the record"), reload: false });
    await expect(signerPdf(requestId, links.coit.token, "fo10", adapters)).rejects.toBeInstanceOf(SignerError);
  }, 30_000);

  it("the second signature takes the accounts from the first signature's record, not the row, which can be edited", async () => {
    const { sign, links, log, mailer: mail, requestId, adapters, signatures } = await submitted();
    await sign(links.coit, "Lillie Coit", { budgetAccount: "Grade 2 stipend (art)", paymentAccount: ACCOUNTS[1] });
    Object.assign(log.rows[0], { budget_account: "Edited", payment_account: ACCOUNTS[0] });
    const state = await signerLinkState(requestId, links.norton.token, adapters);
    expect(state).toMatchObject({ kind: "ready", slot: 2, accounts: { budgetAccount: "Grade 2 stipend (art)", paymentAccount: ACCOUNTS[1], locked: true } });
    mail.sent = [];
    await sign(links.norton, "Joshua Norton", { slot: 2 });
    const [toAp] = mail.to(config.apEmail);
    expect(toAp.text).toContain("Budget Account: Grade 2 stipend (art)");
    expect(toAp.text).toContain(`Payment Account: ${ACCOUNTS[1]}`);
    expect(signatures.records.map((r) => [r.slot, r.budget_account, r.payment_account])).toEqual([
      [1, "Grade 2 stipend (art)", ACCOUNTS[1]],
      [2, "Grade 2 stipend (art)", ACCOUNTS[1]],
    ]);
  }, 30_000);

  it("refuses the second signature when there's no record of the first", async () => {
    const { sign, links, signatures, requestId, adapters } = await submitted();
    await sign(links.coit, "Lillie Coit");
    signatures.records = [];
    expect((await signerLinkState(requestId, links.norton.token, adapters)).kind).toBe("mismatch");
    await expect(sign(links.norton, "Joshua Norton", { slot: 2 })).rejects.toThrow("don't match the record");
  }, 30_000);

  it("finds the first signature by its FO10, whatever order the Signatures tab is in", async () => {
    const { sign, links, signatures, requestId, adapters } = await submitted();
    await sign(links.coit, "Lillie Coit");
    // A failed attempt's leftover, sorted above the real one.
    signatures.records.unshift({ ...signatures.records[0], record_id: "leftover", budget_account: "Wrong", fo10_sha256: "another file" });
    const state = await signerLinkState(requestId, links.alioto.token, adapters);
    expect(state).toMatchObject({ kind: "ready", first: { signer_email: COIT }, accounts: { budgetAccount: "Grade 2 stipend" } });
  }, 30_000);

  it("when AP's email fails after the second signature, says so and lets the requester send it again, to AP only", async () => {
    const { sign, links, log, mailer: mail, requestId, adapters } = await submitted();
    await sign(links.coit, "Lillie Coit");
    mail.sent = [];
    mail.failingFor = [config.apEmail];
    const result = await sign(links.norton, "Joshua Norton", { slot: 2 });
    expect(result).toMatchObject({ slot: 2, emailed: false, receipted: true });
    expect(log.rows[0]).toMatchObject({ status: "Submitted", signers_step: "Signed", authorized_sent_at: "" });
    expect(log.rows[0].notes).toContain("The authorized packet's email to AP failed");
    // The requester's copy says AP has it, so it isn't sent until AP does.
    expect(mail.to(ME)).toEqual([]);
    expect(mail.to(NORTON)[0].text).toContain("didn't go through. Pat Teacher can send it again from their request page.");

    const later = new Date(Date.now() + AUTHORIZED_SENDING_MS + 1000);
    expect(authorizedSending(log.rows[0])).toBe("sending");
    expect(authorizedSending(log.rows[0], later)).toBe("unsent");
    const again = (now?: Date) => sendAuthorizedAgain({ requestId, requesterEmail: ME, linkBase: "https://portal.example", now }, adapters);
    await expect(again()).rejects.toMatchObject({ problem: "too-soon" });
    await expect(again(later)).rejects.toMatchObject({ problem: "failed" });
    mail.failingFor = [];
    mail.sent = [];
    await again(later);
    const [toAp] = mail.to(config.apEmail);
    expect(toAp.attachments?.[0].filename).toBe(`${requestId}-authorized.pdf`);
    expect(toAp.text).toContain(`SHA-256: ${log.rows[0].authorized_pdf_sha256}`);
    expect(mail.to(ME)).toEqual([]);
    expect(log.rows[0].authorized_sent_at).not.toBe("");
    expect(authorizedSending(log.rows[0], later)).toBe("sent");
    await expect(again(later)).rejects.toMatchObject({ problem: "already-sent" });
    await expect(sendAuthorizedAgain({ requestId, requesterEmail: "someone@example.org", linkBase: "", now: later }, adapters)).rejects.toBeInstanceOf(AuthorizedResendError);
  }, 30_000);

  it("when only the requester's copy fails, records that AP has it and blames the copy", async () => {
    const { sign, links, log, mailer: mail } = await submitted();
    await sign(links.coit, "Lillie Coit");
    mail.failingFor = [ME];
    const result = await sign(links.norton, "Joshua Norton", { slot: 2 });
    expect(result.emailed).toBe(true);
    expect(mail.to(config.apEmail)).toHaveLength(1);
    expect(log.rows[0].authorized_sent_at).not.toBe("");
    expect(log.rows[0].notes).toContain("The requester's copy of the authorized packet failed");
    expect(log.rows[0].notes).not.toContain("to AP failed");
  }, 30_000);

  it("won't send an authorized packet again once it doesn't match its hash", async () => {
    const { sign, links, log, files, mailer: mail, requestId, adapters } = await submitted();
    await sign(links.coit, "Lillie Coit");
    mail.failingFor = [config.apEmail];
    await sign(links.norton, "Joshua Norton", { slot: 2 });
    mail.failingFor = [];
    files.files.get(log.rows[0].authorized_pdf_file_id)!.bytes = new Uint8Array([1, 2, 3]);
    const later = new Date(Date.now() + AUTHORIZED_SENDING_MS + 1000);
    await expect(sendAuthorizedAgain({ requestId, requesterEmail: ME, linkBase: "", now: later }, adapters)).rejects.toMatchObject({ problem: "mismatch" });
    expect(mail.to(config.apEmail)).toEqual([]);
  }, 30_000);

  it("a send-back returns the request, tells the requester and AP, and stops every link", async () => {
    const { links, log, mailer: mail, requestId, adapters, sign } = await submitted();
    await sendBackAsSigner({ ...links.norton, slot: 1, version: 1, name: "Joshua Norton", note: "The receipt is for a different store.", ip: "", userAgent: "", linkBase: "https://portal.example" }, adapters);
    expect(log.rows[0]).toMatchObject({ status: "Returned", signers_step: "Sent back", returned_note: "The receipt is for a different store." });
    const [back] = mail.to(ME);
    expect(back.cc).toEqual([config.apEmail]);
    expect(back.text).toContain("Joshua Norton (norton@example.org), one of the PTA's check signers, sent your request");
    expect(back.text).toContain("The receipt is for a different store.");
    const state = await signerLinkState(requestId, links.coit.token, adapters);
    expect(state).toMatchObject({ kind: "done", status: expect.stringMatching(/^Sent back by Joshua Norton on \w+ \d+\.$/) });
    await expect(sign(links.coit, "Lillie Coit")).rejects.toThrow("Sent back by Joshua Norton");
  }, 30_000);

  it("stops the links of a signer taken off CHECK_SIGNERS, and of a re-signed version", async () => {
    const { links, requestId, adapters, log } = await submitted();
    config.checkSigners = [NORTON, ALIOTO];
    expect((await signerLinkState(requestId, links.coit.token, adapters)).kind).toBe("not-signer");
    log.rows[0].version = 2;
    expect((await signerLinkState(requestId, links.norton.token, adapters)).kind).toBe("stale");
  }, 30_000);

  it("the requester can resend to signers the email missed at once, and to everyone once a day", async () => {
    const w = await setup();
    w.mailer.failingFor = [ALIOTO];
    const { requestId } = await w.submit();
    expect(w.log.rows[0].signers_sent_to).toBe(`${COIT}, ${NORTON}`);
    expect(w.log.rows[0].notes).toContain("Email to the check signers (alioto@example.org) failed");
    w.mailer.failingFor = [];
    w.mailer.sent = [];
    const resend = (now?: Date) => resendToSigners({ requestId, requesterEmail: ME, linkBase: "https://portal.example", now }, w.adapters);
    await expect(resend()).resolves.toEqual({ sentTo: [ALIOTO] });
    expect(w.mailer.to(ALIOTO)[0].subject).toMatch(/^Reminder: please authorize: /);
    expect(w.log.rows[0].signers_sent_to).toBe(`${COIT}, ${NORTON}, ${ALIOTO}`);
    await expect(resend()).rejects.toMatchObject({ problem: "too-soon" });
    await expect(resend(new Date(Date.now() + 25 * 3_600_000))).resolves.toEqual({ sentTo: [COIT, NORTON, ALIOTO] });
    await expect(resendToSigners({ requestId, requesterEmail: "someone@example.org", linkBase: "" }, w.adapters)).rejects.toBeInstanceOf(SignerResendError);
  }, 30_000);

  it("a mailed request for an event goes to the chair first, then to the signers with the co-signed packet", async () => {
    const chair = "chair@example.org";
    const event: EventRow = { name: "Fun Run", chair_email: chair, aliases: "", budget: "", active: "", note: "" };
    const w = await setup({ events: [event], funding: "none", event: "Fun Run" });
    const { requestId } = await w.submit();
    expect(w.log.rows[0]).toMatchObject({ status: "Awaiting chair", signers_step: "" });
    expect(w.mailer.to(COIT)).toEqual([]);
    expect(w.mailer.to(ME)[0].text).toContain("Once they sign, it goes to two of the PTA's check signers");
    const chairLink = w.mailer.to(chair)[0].text.match(/\/chair\/([^?\s]+)\?t=(\S+)/)!;
    w.mailer.sent = [];
    const signed = await signAsChair(
      { requestId, token: decodeURIComponent(chairLink[2]), name: "Maya Angelou", signature: { type: "typed", name: "Maya Angelou" }, note: "", ip: "", userAgent: "", linkBase: "https://portal.example" },
      w.adapters,
    );
    expect(signed).toMatchObject({ mailed: true, emailed: true });
    expect(w.log.rows[0]).toMatchObject({ status: "Awaiting signers", signers_step: "Waiting", chair_step: "Signed" });
    expect(w.mailer.to(config.apEmail)).toEqual([]);
    const [toCoit] = w.mailer.to(COIT);
    expect(toCoit.attachments?.[0].filename).toBe(`${requestId}-cosigned.pdf`);
    expect(toCoit.text).toContain("Signed by the Fun Run chair: Maya Angelou");
    // No stipend: the Budget Account starts as the event.
    expect(toCoit.text).toContain("Budget Account: Fun Run");
    expect(w.mailer.to(chair)[0].text).toContain("It has gone to the PTA's check signers");
  }, 30_000);

  it("never sends a mailed check on to AP without its authorized packet", async () => {
    const input = { requestId: "FY27-001", request: mailed(["r1"]), requesterEmail: ME, submittedAt: new Date(), sha256: "x", version: 1, funding: [], linkBase: "" };
    await expect(sendPacketOn(input, { filename: "a.pdf", mimeType: "application/pdf", bytes: new Uint8Array() }, world().mailer)).rejects.toThrow("Refusing");
  });
});

describe("the FO10's Budget Account and the flags", () => {
  it("starts from the stipends, then the event, else blank", () => {
    expect(budgetAccountDefault(request(["a"], "grade:2"))).toBe("Grade 2 stipend");
    expect(budgetAccountDefault(request(["a", "b", "c"], ["classroom", "grade:2", "classroom"]))).toBe("Classroom stipend; Grade 2 stipend");
    expect(budgetAccountDefault(request(["a", "b"], ["none", "classroom"]))).toBe("Classroom stipend");
    expect(budgetAccountDefault(request(["a"], "none", 0, "Fun Run"))).toBe("Fun Run");
    expect(budgetAccountDefault(request(["a"]))).toBe("");
  });

  it("flags a first mailed request, a changed address and a changed payee name", () => {
    const row = { request_id: "FY27-009", submitted_at: "2026-11-10T00:00:00Z" };
    const earlier = (id: string, at: string, extra: object) => ({ request_id: id, submitted_at: at, check_delivery: "mailbox", address: "", city_zip: "", payee_name: "Pat Teacher", ...extra }) as never;
    const req = { payeeName: "Pat Teacher", ...ADDRESS };
    expect(signerFlags(row, req, [])).toEqual(["This is the first mailed request from this account."]);
    const sameAddress = earlier("FY27-001", "2026-10-01T00:00:00Z", { check_delivery: "mail", address: "123 main st apt 4", city_zip: "San Francisco CA 94127" });
    expect(signerFlags(row, req, [sameAddress])).toEqual([]);
    const moved = earlier("FY27-002", "2026-10-02T00:00:00Z", { check_delivery: "mail", address: "9 Elm St", city_zip: "Oakland, CA 94601" });
    expect(signerFlags(row, req, [sameAddress, moved])).toEqual(["The address differs from this account's last mailed request (FY27-002)."]);
    // Later requests don't count.
    const later = earlier("FY27-010", "2026-11-11T00:00:00Z", { check_delivery: "mail", address: "1 Other St", city_zip: "SF, CA 94110", payee_name: "Someone" });
    expect(signerFlags(row, req, [sameAddress, later])).toEqual([]);
    expect(signerFlags(row, { ...req, payeeName: "Mallory Thief" }, [sameAddress])).toEqual([`The payee name differs from the one on this account's earlier requests ("Pat Teacher").`]);
  });
});
