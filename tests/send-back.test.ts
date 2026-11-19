import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { EventRow, MailMessage, RequestRow, UserRecord } from "@/server/adapters/types";
import { config } from "@/server/config";
import { answersForChair } from "@/server/email/templates";
import { ChairError, chairLinkState, chairStateMessage, sendBackAsChair, signAsChair } from "@/server/requests/chair";
import { lockTiming } from "@/server/requests/lock";
import { loadReceiptFiles, ReceiptError } from "@/server/requests/receipts";
import { fixProblem, ResubmitError, resubmitRequest, returnedAtOf } from "@/server/requests/resubmit";
import { sendBackAsSigner, signAsSigner, signerLinkState } from "@/server/requests/signers";
import { fundingAsOf, fundingOptions } from "@/server/requests/stipends";
import { loadStoredRequest, requestFolder } from "@/server/requests/stored";
import { submitRequest } from "@/server/requests/submit";
import { fiscalYearLabel } from "@/lib/fiscal-year";
import type { RequestInput } from "@/lib/request-schema";
import { jpeg, ME, request, session, tab, teacher, world } from "./support";

const LILLIE = "lillie@example.org";
const NORTON = "norton@example.org";
const COIT = "coit@example.org";
const ALIOTO = "alioto@example.org";
const LINK_BASE = "https://portal.example";
const funRun = (extra: Partial<EventRow> = {}): EventRow => ({ name: "Fun Run", chair_email: `${LILLIE}, ${NORTON}`, aliases: "", budget: "500", active: "", note: "", ...extra });

/** The request ID and token in a chair's or check signer's email. */
function linkIn(mail: MailMessage, kind: "chair" | "signers" = "chair"): { requestId: string; token: string } {
  const match = mail.text.match(new RegExp(`/${kind}/([^?\\s]+)\\?t=(\\S+)`));
  if (!match) throw new Error(`no ${kind} link in: ${mail.text}`);
  return { requestId: decodeURIComponent(match[1]), token: decodeURIComponent(match[2]) };
}

async function setup(opts: { events?: EventRow[]; user?: UserRecord } = {}) {
  const w = world();
  const user = opts.user ?? teacher;
  w.eventRows.push(...(opts.events ?? [funRun()]));
  w.files.add("r1", user.email, await jpeg());
  const signed = { signature: { type: "typed" as const, name: "Pat Teacher" }, session: session(user), ip: "127.0.0.1", userAgent: "vitest", linkBase: LINK_BASE };
  const submit = (input: RequestInput = request(["r1"], "none", 0, "Fun Run")) => submitRequest({ ...signed, request: input }, w.adapters);
  const resubmit = (requestId: string, input: RequestInput, version = 1, who: UserRecord = user) =>
    resubmitRequest({ ...signed, session: session(who), requestId, version, request: input }, w.adapters);
  const sendBack = (link: { requestId: string; token: string }, note = "The second receipt is for the Book Fair.") =>
    sendBackAsChair({ ...link, note, linkBase: LINK_BASE }, w.adapters);
  const sign = (link: { requestId: string; token: string }, name = "Lillie Coit") =>
    signAsChair({ ...link, name, signature: { type: "typed", name }, note: "", ip: "10.0.0.1", userAgent: "vitest", linkBase: LINK_BASE }, w.adapters);
  return { ...w, submit, resubmit, sendBack, sign };
}

describe("sending back and fixing a request", () => {
  const saved = { ...config };
  const settleMs = lockTiming.settleMs;
  beforeEach(() => {
    config.sendPacketsTo = "ap";
    // The in-memory log writes at once, so there is nothing to wait for.
    lockTiming.settleMs = 0;
  });
  afterEach(() => {
    Object.assign(config, saved);
    lockTiming.settleMs = settleMs;
  });

  describe("the chair's Send back", () => {
    it("returns the request, emails the requester the note with a way to fix it, and stops every chair link", async () => {
      const { log, mailer, adapters, submit, sendBack, sign } = await setup();
      const { requestId } = await submit();
      const lillie = linkIn(mailer.to(LILLIE)[0]);
      const norton = linkIn(mailer.to(NORTON)[0]);
      mailer.sent = [];

      expect(await sendBack(lillie)).toEqual({ emailed: true });
      const row = log.rows[0];
      expect(row).toMatchObject({ status: "Returned", chair_step: "Sent back", returned_note: "The second receipt is for the Book Fair.", returned_by: LILLIE, lock: "" });
      expect(row.returned_at).not.toBe("");
      // Nothing was signed, and nothing reached AP.
      expect(row).toMatchObject({ chair_signed_by: "", chair_pdf_file_id: "" });
      expect(mailer.to(config.apEmail)).toEqual([]);

      const [back] = mailer.sent;
      expect(back.to).toEqual([ME]);
      expect(back.subject).toBe(`Sent back: your PTA reimbursement request ${requestId} ($10.00)`);
      // The email holds no signing link, so replies can go to the chair who sent it back.
      expect(back.replyTo).toBe(LILLIE);
      expect(back.text).toContain(`${LILLIE}, the Fun Run chair, sent your request ${requestId} back instead of signing it.`);
      expect(back.text).toContain("The second receipt is for the Book Fair.");
      expect(back.text).toContain(`Fix it here: ${LINK_BASE}/requests/${requestId}/fix`);
      expect(back.text).not.toMatch(/\/chair\//);

      // Every chair's link now says it went back, and can't sign or send back again.
      const state = await chairLinkState(requestId, norton.token, adapters);
      expect(state.kind).toBe("closed");
      if (state.kind === "closed") expect(chairStateMessage(state)).toMatch(new RegExp(`^This request was sent back to Pat Teacher by ${LILLIE} on \\w+ \\d+, so there's nothing to sign\\.`));
      await expect(sign(norton, "Emperor Norton")).rejects.toBeInstanceOf(ChairError);
      await expect(sendBack(norton)).rejects.toBeInstanceOf(ChairError);
      expect(log.rows[0].returned_by).toBe(LILLIE);
    }, 30_000);

    it("needs a note, and refuses a link that isn't a current chair's", async () => {
      const { log, mailer, eventRows, submit, sendBack } = await setup();
      await submit();
      const lillie = linkIn(mailer.to(LILLIE)[0]);
      await expect(sendBack(lillie, "   ")).rejects.toThrow("Say what needs to change");
      eventRows[0] = funRun({ chair_email: NORTON });
      await expect(sendBack(lillie)).rejects.toThrow(`${LILLIE} isn't listed as a Fun Run chair any more`);
      expect(log.rows[0]).toMatchObject({ status: "Awaiting chair", chair_step: "Waiting", returned_note: "", lock: "" });
    }, 30_000);

    it("lets only one of a co-chair's signature and a send-back at the same moment through", async () => {
      const { log, mailer, submit, sendBack, sign } = await setup();
      await submit();
      const lillie = linkIn(mailer.to(LILLIE)[0]);
      const norton = linkIn(mailer.to(NORTON)[0]);
      mailer.sent = [];
      const results = await Promise.allSettled([sign(lillie), sendBack(norton)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: expect.any(ChairError) });
      const row = log.rows[0];
      // Either it was signed and went to AP, or it went back and AP has nothing; never both.
      if (row.status === "Submitted") expect(mailer.sent.filter((m) => m.subject.startsWith("Sent back"))).toEqual([]);
      else expect(mailer.to(config.apEmail)).toEqual([]);
      expect(row.lock).toBe("");
    }, 30_000);

    it("notes on the row when the email to the requester doesn't go, and still sends it back", async () => {
      const { log, mailer, submit, sendBack } = await setup();
      await submit();
      const lillie = linkIn(mailer.to(LILLIE)[0]);
      mailer.failingFor = [ME];
      expect(await sendBack(lillie)).toEqual({ emailed: false });
      expect(log.rows[0]).toMatchObject({ status: "Returned", chair_step: "Sent back" });
      expect(log.rows[0].notes).toContain("Email that the Fun Run chair sent it back failed");
    }, 30_000);
  });

  describe("Fix and re-sign", () => {
    it("signs a returned request again as version 2, which goes back to the chairs with fresh links and the note it answers", async () => {
      const { log, mailer, files, adapters, submit, resubmit, sendBack, sign } = await setup();
      const first = await submit();
      const { requestId } = first;
      const oldLink = linkIn(mailer.to(LILLIE)[0]);
      await sendBack(oldLink);
      const before = { ...log.rows[0] };
      const v1Bytes = files.files.get(first.pdfFileId)!.bytes.slice();
      mailer.sent = [];
      // The receipt is already in the request's folder: a move now would fail and be noted.
      files.failMoves = true;

      const fixed = { ...request(["r1"], "none", 0, "Fun Run"), purpose: "Fun Run water station" };
      const result = await resubmit(requestId, fixed);
      expect(result).toMatchObject({ requestId, version: 2, emailed: true, chair: { event: "Fun Run", sentTo: [LILLIE, NORTON], notReached: [] } });

      const row = log.rows[0];
      expect(log.rows).toHaveLength(1);
      expect(row).toMatchObject({
        status: "Awaiting chair",
        version: 2,
        purpose: "Fun Run water station",
        chair_step: "Waiting",
        chair_sent_to: `${LILLIE}, ${NORTON}`,
        previous_pdf_file_ids: before.pdf_file_id,
        pdf_sha256: result.sha256,
        // The return stays on the row, so the Sheet shows what this version answers.
        returned_note: before.returned_note,
        returned_by: LILLIE,
        lock: "",
      });
      expect(row.notes).toBe("");
      expect(row.pdf_file_id).not.toBe(before.pdf_file_id);
      // When this version was signed: the stored request's time, not the first version's.
      expect(row.submitted_at).toBe((await loadStoredRequest(files, row.request_file_id)).submittedAt);

      // Its own files, beside the first version's, which is unchanged.
      const pdf = files.files.get(row.pdf_file_id)!;
      expect(pdf.name).toBe(`${requestId}-v2.pdf`);
      expect(pdf.folderPath).toEqual(requestFolder(row));
      expect(files.files.get(row.request_file_id)!.name).toBe(`${requestId}-v2.json`);
      expect(files.files.get(first.pdfFileId)!.bytes).toEqual(v1Bytes);
      expect((await PDFDocument.load(pdf.bytes)).getTitle()).toBe(`PTA reimbursement request ${requestId} v2`);
      const stored = await loadStoredRequest(files, row.request_file_id);
      expect(stored).toMatchObject({
        requestId,
        version: 2,
        request: { purpose: "Fun Run water station", event: "Fun Run" },
        answers: { note: "The second receipt is for the Book Fair.", by: `the Fun Run chair (${LILLIE})`, at: before.returned_at },
        packet: { sha256: result.sha256 },
      });

      // The chairs get version 2, with the note it answers; nothing goes to AP yet.
      expect(mailer.to(config.apEmail)).toEqual([]);
      const [toLillie] = mailer.to(LILLIE);
      expect(toLillie.subject).toBe(`Please sign: Fun Run reimbursement for Pat Teacher, $10.00 (${requestId}, version 2)`);
      expect(toLillie.text).toContain("This is version 2: the request was sent back, and Pat Teacher changed it and signed it again.");
      expect(toLillie.text).toMatch(new RegExp(`Sent back by the Fun Run chair \\(${LILLIE}\\) on \\w+ \\d+, with this note: The second receipt is for the Book Fair\\.`));
      expect(toLillie.attachments?.[0].filename).toBe(`${requestId}-v2.pdf`);
      expect(mailer.to(ME)[0].subject).toContain(`${requestId}, version 2`);

      // The first version's links are stale; the new ones sign version 2.
      expect((await chairLinkState(requestId, oldLink.token, adapters)).kind).toBe("stale");
      const newLink = linkIn(toLillie);
      mailer.sent = [];
      await sign(newLink);
      expect(log.rows[0]).toMatchObject({ status: "Submitted", chair_step: "Signed", version: 2 });
      expect(files.files.get(log.rows[0].chair_pdf_file_id)!.name).toBe(`${requestId}-v2-cosigned.pdf`);
      const [toAp] = mailer.to(config.apEmail);
      expect(toAp.subject).toBe(`Reimbursement request ${requestId}, version 2 - Pat Teacher - $10.00`);
      expect(toAp.text).toContain(`Request: ${requestId} (version 2)`);
      expect(toAp.text).toContain("with this note: The second receipt is for the Book Fair.");
      expect(toAp.attachments?.[0].filename).toBe(`${requestId}-v2-cosigned.pdf`);
    }, 30_000);

    it("can take the event off, and then goes straight on with the chair's columns cleared", async () => {
      const { log, mailer, submit, resubmit, sendBack } = await setup();
      const { requestId } = await submit();
      await sendBack(linkIn(mailer.to(LILLIE)[0]), "This wasn't for the Fun Run.");
      mailer.sent = [];
      const result = await resubmit(requestId, request(["r1"], "none", 0, ""));
      expect(result.chair).toBeNull();
      expect(log.rows[0]).toMatchObject({ status: "Submitted", version: 2, event: "", chair_step: "", chair_sent_to: "", chair_sent_at: "" });
      expect(mailer.to(LILLIE)).toEqual([]);
      const [toAp] = mailer.to(config.apEmail);
      expect(toAp.subject).toContain(`${requestId}, version 2`);
      expect(toAp.text).toContain(`Sent back by the Fun Run chair (${LILLIE})`);
      expect(toAp.text).toContain("This wasn't for the Fun Run.");
    }, 30_000);

    it("keeps the event a returned request names even after it has been made inactive", async () => {
      const { log, mailer, eventRows, submit, resubmit, sendBack } = await setup();
      const { requestId } = await submit();
      await sendBack(linkIn(mailer.to(LILLIE)[0]));
      eventRows[0] = funRun({ active: "no" });
      await resubmit(requestId, request(["r1"], "none", 0, "Fun Run"));
      expect(log.rows[0]).toMatchObject({ status: "Awaiting chair", event: "Fun Run", version: 2 });
    }, 30_000);

    it("sends a request AP returned by hand straight back to AP as version 2, with the note it answers", async () => {
      const { log, mailer, submit, resubmit } = await setup({ events: [] });
      const { requestId } = await submit(request(["r1"]));
      Object.assign(log.rows[0], { status: "Returned", returned_note: "Please add the receipt total." });
      mailer.sent = [];
      await resubmit(requestId, request(["r1"]));
      expect(log.rows[0]).toMatchObject({ status: "Submitted", version: 2 });
      const [toAp] = mailer.to(config.apEmail);
      expect(toAp.text).toContain("Sent back by the PTA's accounts payable team, with this note: Please add the receipt total.");
      expect(toAp.attachments?.[0].filename).toBe(`${requestId}-v2.pdf`);
    }, 30_000);

    it("moves new receipts into the request's folder, and still refuses one another request used", async () => {
      const { log, mailer, files, submit, resubmit, sendBack } = await setup();
      const { requestId } = await submit();
      await sendBack(linkIn(mailer.to(LILLIE)[0]));
      files.add("r2", ME, await jpeg());
      files.add("used", ME, await jpeg(), "FY27-999");
      await expect(resubmit(requestId, request(["r1", "used"], "none", 0, "Fun Run"))).rejects.toBeInstanceOf(ReceiptError);
      expect(log.rows[0]).toMatchObject({ status: "Returned", version: 1 });

      await resubmit(requestId, request(["r1", "r2"], "none", 0, "Fun Run"));
      expect(log.rows[0]).toMatchObject({ version: 2, line_count: 2, receipt_count: 2 });
      expect(files.files.get("r2")!.attachedTo).toBe(requestId);
      expect(files.files.get("r1")!.attachedTo).toBe(requestId);
    }, 30_000);

    it("refuses someone else's request, one that isn't returned, and a version signed since; a double press makes one version", async () => {
      const { log, mailer, files, submit, resubmit, sendBack } = await setup();
      const { requestId } = await submit();
      const input = request(["r1"], "none", 0, "Fun Run");
      await expect(resubmit(requestId, input)).rejects.toThrow("isn't waiting for a fix");
      await sendBack(linkIn(mailer.to(LILLIE)[0]));
      await expect(resubmit(requestId, input, 1, { ...teacher, email: "someone@example.org" })).rejects.toThrow("wasn't found");
      await expect(resubmit(requestId, input, 2)).rejects.toThrow("was signed again since you opened it");

      const results = await Promise.allSettled([resubmit(requestId, input), resubmit(requestId, input)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: expect.any(ResubmitError) });
      expect(log.rows[0]).toMatchObject({ version: 2, lock: "" });
      expect([...files.files.values()].filter((f) => f.name === `${requestId}-v2.pdf`)).toHaveLength(1);
      expect([...files.files.values()].filter((f) => f.name.includes("-v3"))).toEqual([]);
    }, 30_000);

    it("says why a request can't be fixed", () => {
      const row = { request_id: "FY27-001", requester_email: ME, status: "Returned", request_file_id: "json-1" } as Parameters<typeof fixProblem>[0];
      expect(fixProblem(row, ME.toUpperCase())).toBeNull();
      expect(fixProblem(null, ME)).toBe("That request wasn't found.");
      expect(fixProblem({ ...row!, status: "Submitted" }, ME)).toContain("isn't waiting for a fix");
      expect(fixProblem({ ...row!, request_file_id: "" }, ME)).toContain("Start a new request with the change");
    });

    it("lets a returned request's next version, and only that, use the receipts already in its folder", async () => {
      const { files } = world();
      files.add("mine", ME, await jpeg(), "FY27-001");
      const input = request(["mine"]);
      await expect(loadReceiptFiles(input, ME, files)).rejects.toBeInstanceOf(ReceiptError);
      await expect(loadReceiptFiles(input, ME, files, "FY27-002")).rejects.toBeInstanceOf(ReceiptError);
      const loaded = await loadReceiptFiles(input, ME, files, "FY27-001");
      expect(loaded.get("mine")).toMatchObject({ attached: true });
      await expect(loadReceiptFiles(input, "someone@example.org", files, "FY27-001")).rejects.toThrow("does not belong to this sign-in");
    });

    it("keeps every version in the folder of the year the request was first submitted", () => {
      expect(requestFolder({ request_id: "FY27-042", submitted_at: "2027-08-02T17:00:00.000Z" })).toEqual(["requests", "FY27", "FY27-042"]);
      expect(requestFolder({ request_id: "OLD-1", submitted_at: "2026-10-02T17:00:00.000Z" })).toEqual(["requests", "FY27", "OLD-1"]);
    });
  });

  describe("a mailed check sent back by a check signer", () => {
    const ACCOUNTS = ["Bill pay checking ••1234"];
    const ADDRESS = { address: "123 Main St Apt 4", cityStateZip: "San Francisco, CA 94127" };
    beforeEach(() => {
      config.checkSigners = [COIT, NORTON, ALIOTO];
      config.billPayAccounts = [...ACCOUNTS];
      config.mailedChecks = "pilot";
    });

    it("is fixed the same way, needs both signatures again, and stops the earlier links", async () => {
      const w = await setup({ events: [], user: { ...teacher, mailed_checks: "yes" } });
      const mailed = { ...request(["r1"], "grade:2"), checkDelivery: "mail" as const, ...ADDRESS };
      const { requestId } = await w.submit(mailed);
      const coit = linkIn(w.mailer.to(COIT)[0], "signers");
      const norton = linkIn(w.mailer.to(NORTON)[0], "signers");
      const signerAction = { slot: 1 as const, version: 1, ip: "", userAgent: "", linkBase: LINK_BASE };
      await signAsSigner({ ...coit, ...signerAction, name: "Lillie Coit", signature: { type: "typed", name: "Lillie Coit" }, note: "", budgetAccount: "Grade 2 stipend", paymentAccount: ACCOUNTS[0] }, w.adapters);
      w.mailer.sent = [];
      await sendBackAsSigner({ ...norton, ...signerAction, slot: 2, name: "Joshua Norton", note: "The address is missing the apartment." }, w.adapters);
      expect(w.log.rows[0]).toMatchObject({ status: "Returned", signers_step: "Sent back", returned_by: NORTON });
      const [back] = w.mailer.to(ME);
      expect(back.text).toContain('tap "Fix and re-sign"');
      expect(back.text).toContain("The new version needs two of the PTA's check signers to sign it again.");
      expect(back.text).toContain(`Fix it here: ${LINK_BASE}/requests/${requestId}/fix`);

      w.mailer.sent = [];
      const result = await w.resubmit(requestId, { ...mailed, address: "123 Main St Apt 5" });
      expect(result).toMatchObject({ version: 2, signers: { reached: 3, notReached: 0 } });
      expect(w.log.rows[0]).toMatchObject({
        status: "Awaiting signers",
        version: 2,
        address: "123 Main St Apt 5",
        signers_step: "Waiting",
        signers_sent_to: `${COIT}, ${NORTON}, ${ALIOTO}`,
        signer_1_email: "",
        signer_1_name: "",
        budget_account: "",
        payment_account: "",
        fo10_file_id: "",
        fo10_sha256: "",
      });
      expect(await loadStoredRequest(w.files, w.log.rows[0].request_file_id)).toMatchObject({ answers: { by: "Joshua Norton, one of the PTA's check signers" } });

      // The first signer's old link is stale, and the new emails ask for both signatures again.
      expect((await signerLinkState(requestId, coit.token, w.adapters)).kind).toBe("stale");
      const [toCoit] = w.mailer.to(COIT);
      expect(toCoit.subject).toBe(`Please authorize: mailed check to Pat Teacher, $10.00 (${requestId}, version 2)`);
      expect(toCoit.text).toContain("It needs two signatures again");
      expect(toCoit.text).toContain("Mail the check to: 123 Main St Apt 5, San Francisco, CA 94127");
      expect(toCoit.attachments?.map((a) => a.filename)).toEqual([`${requestId}-v2.pdf`, `${requestId}-v2-fo10.pdf`]);
      const state = await signerLinkState(requestId, linkIn(toCoit, "signers").token, w.adapters);
      expect(state).toMatchObject({ kind: "ready", slot: 1, accounts: { locked: false } });
    }, 30_000);

    it("for an event, goes back to the chair, who is told a check signer sent it back but not the note, which may hold the address", async () => {
      const w = await setup({ events: [funRun()], user: { ...teacher, mailed_checks: "yes" } });
      const mailed = { ...request(["r1"], "grade:2", 0, "Fun Run"), checkDelivery: "mail" as const, ...ADDRESS };
      const { requestId } = await w.submit(mailed);
      await w.sign(linkIn(w.mailer.to(LILLIE)[0]));
      expect(w.log.rows[0]).toMatchObject({ status: "Awaiting signers", chair_step: "Signed" });
      const alioto = linkIn(w.mailer.to(ALIOTO)[0], "signers");
      w.mailer.sent = [];
      const note = "Mail it to 123 Main St Apt 5 instead; Apt 4 was a typo.";
      await sendBackAsSigner({ ...alioto, slot: 1, version: 1, ip: "", userAgent: "", linkBase: LINK_BASE, name: "Joseph Alioto", note }, w.adapters);
      expect(w.mailer.to(ME)[0].text).toContain("The new version needs the Fun Run chair and then two of the PTA's check signers to sign it again.");

      w.mailer.sent = [];
      await w.resubmit(requestId, { ...mailed, address: "123 Main St Apt 5" });
      expect(w.log.rows[0]).toMatchObject({ status: "Awaiting chair", chair_step: "Waiting", chair_signed_by: "", chair_pdf_file_id: "", signers_step: "", version: 2 });
      expect(await loadStoredRequest(w.files, w.log.rows[0].request_file_id)).toMatchObject({ answers: { from: "signer", note, by: "Joseph Alioto, one of the PTA's check signers" } });

      // The chair is told who sent it back, but never the note: it names the home address the chair doesn't see.
      const [toChair] = w.mailer.to(LILLIE);
      expect(toChair.text).toContain("Sent back by one of the PTA's check signers on");
      expect(toChair.text).not.toContain(note);
      expect(toChair.text).not.toContain("Apt");
      expect(toChair.text).not.toContain("Joseph Alioto");

      // Once the chair signs version 2, the check signers get it with the note.
      w.mailer.sent = [];
      await w.sign(linkIn(toChair));
      expect(w.mailer.to(LILLIE)[0].subject).toBe(`Signed: Fun Run reimbursement for Pat Teacher (${requestId}, version 2)`);
      expect(w.log.rows[0]).toMatchObject({ status: "Awaiting signers", chair_step: "Signed", signers_step: "Waiting" });
      const [toSigner] = w.mailer.to(COIT);
      expect(toSigner.text).toContain(`Sent back by Joseph Alioto, one of the PTA's check signers on`);
      expect(toSigner.text).toContain(note);
      expect(toSigner.attachments?.map((a) => a.filename)).toEqual([`${requestId}-v2-cosigned.pdf`, `${requestId}-v2-fo10.pdf`]);
    }, 30_000);
  });

  describe("a request fixed after June 30", () => {
    it("counts its stipends with its own fiscal year's requests, by its ID", () => {
      const july = new Date("2026-07-03T18:00:00.000Z");
      const asOf = fundingAsOf("FY26-031", july);
      expect(fiscalYearLabel(asOf)).toBe("FY26");
      expect(asOf.toISOString()).toBe("2026-06-30T19:00:00.000Z");
      expect(fundingAsOf("FY27-002", july)).toBe(july);
      expect(fundingAsOf("hand-typed", july)).toBe(july);

      // A FY26 request still counts against FY26's classroom stipend, not FY27's.
      const rows = [{ request_id: "FY26-031", requester_email: ME, status: "Awaiting chair", funding: "Classroom stipend", reimbursement_claimed: "40.00" } as RequestRow];
      const classroom = (at: Date) => fundingOptions(teacher, tab, rows, at).stipends.find((s) => s.id === "classroom")!.usedCents;
      expect(classroom(asOf)).toBe(4000);
      expect(classroom(july)).toBe(0);
    });
  });

  describe("which return a version answers", () => {
    it("tells the chair a check signer's or AP's return only by who sent it", () => {
      const chair = { note: "Wrong event.", by: `the Fun Run chair (${LILLIE})`, from: "chair" as const, at: "" };
      expect(answersForChair(chair)).toBe(chair);
      expect(answersForChair({ ...chair, from: "signer", by: "Joseph Alioto, one of the PTA's check signers" })).toEqual({ ...chair, from: "signer", by: "one of the PTA's check signers", note: "" });
      expect(answersForChair({ ...chair, from: "ap", by: "the PTA's accounts payable team" })).toMatchObject({ by: "the PTA's accounts payable team", note: "" });
      expect(answersForChair(undefined)).toBeUndefined();
    });

    it("dates a return only when the row records it for this version", () => {
      expect(returnedAtOf({ returned_at: "2026-11-20T18:00:00.000Z", submitted_at: "2026-11-19T18:00:00.000Z" })).toBe("2026-11-20T18:00:00.000Z");
      // Set by hand in the Sheet after version 2 was signed: the cell is still the first return's.
      expect(returnedAtOf({ returned_at: "2026-11-14T18:00:00.000Z", submitted_at: "2026-11-19T18:00:00.000Z" })).toBe("");
      expect(returnedAtOf({ returned_at: "", submitted_at: "2026-11-19T18:00:00.000Z" })).toBe("");
    });

    it("an AP return of version 2, set by hand, answered by version 3 with no stale date and no note for the chair", async () => {
      const { log, mailer, files, submit, resubmit, sendBack, sign } = await setup();
      const { requestId } = await submit();
      await sendBack(linkIn(mailer.to(LILLIE)[0]));
      const chairReturnedAt = log.rows[0].returned_at;
      mailer.sent = [];
      await resubmit(requestId, request(["r1"], "none", 0, "Fun Run"));
      await sign(linkIn(mailer.to(LILLIE)[0]));
      expect(log.rows[0]).toMatchObject({ status: "Submitted", version: 2 });

      // AP returns it by hand: status and note only.
      Object.assign(log.rows[0], { status: "Returned", returned_note: "This puts you $40 over your classroom stipend." });
      mailer.sent = [];
      await resubmit(requestId, request(["r1"], "none", 0, "Fun Run"), 2);
      const row = log.rows[0];
      expect(row).toMatchObject({ status: "Awaiting chair", version: 3, returned_at: chairReturnedAt });
      expect((await loadStoredRequest(files, row.request_file_id)).answers).toEqual({
        note: "This puts you $40 over your classroom stipend.",
        by: "the PTA's accounts payable team",
        from: "ap",
        at: "",
      });

      // No date from the chair's earlier return, in any email about version 3.
      const [toMe] = mailer.to(ME);
      expect(toMe.text).toContain("Sent back by the PTA's accounts payable team, with this note: This puts you $40 over your classroom stipend.");
      // The chair is told AP sent it back, but not AP's note, which is about stipends.
      const [toChair] = mailer.to(LILLIE);
      expect(toChair.subject).toContain(`${requestId}, version 3`);
      expect(toChair.text).toContain("Sent back by the PTA's accounts payable team.");
      expect(toChair.text).not.toContain("stipend");
    }, 30_000);
  });
});
