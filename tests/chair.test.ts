import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { EventRow, MailMessage, UserRecord } from "@/server/adapters/types";
import { config } from "@/server/config";
import { ChairError, chairLinkState, ResendError, resendToChair, signAsChair } from "@/server/requests/chair";
import { loadStoredRequest } from "@/server/requests/stored";
import { EventError, submitRequest } from "@/server/requests/submit";
import { jpeg, ME, request, session, teacher, world } from "./support";

const LILLIE = "lillie@example.org";
const NORTON = "norton@example.org";
const funRun = (extra: Partial<EventRow> = {}): EventRow => ({ name: "Fun Run", chair_email: `${LILLIE}, ${NORTON}`, aliases: "", budget: "500", active: "", note: "", ...extra });

/** The request ID and token in a chair email's signing link. */
function linkIn(mail: MailMessage): { requestId: string; token: string } {
  const match = mail.text.match(/\/chair\/([^?\s]+)\?t=(\S+)/);
  if (!match) throw new Error(`no chair link in: ${mail.text}`);
  return { requestId: decodeURIComponent(match[1]), token: decodeURIComponent(match[2]) };
}

async function setup(events: EventRow[] = [funRun()], user: UserRecord = teacher) {
  const w = world();
  w.eventRows.push(...events);
  w.files.add("r1", user.email, await jpeg());
  const submit = (event = "Fun Run") =>
    submitRequest(
      { request: request(["r1"], "none", 0, event), signature: { type: "typed", name: "Pat Teacher" }, session: session(user), ip: "127.0.0.1", userAgent: "vitest", linkBase: "https://portal.example" },
      w.adapters,
    );
  return { ...w, submit };
}

const sign = (adapters: Parameters<typeof signAsChair>[1], link: { requestId: string; token: string }, name = "Lillie Coit") =>
  signAsChair({ ...link, name, signature: { type: "typed", name }, note: "Water station", ip: "10.0.0.1", userAgent: "vitest", linkBase: "https://portal.example" }, adapters);

describe("the event chair step", () => {
  const defaultRecipient = config.sendPacketsTo;
  beforeEach(() => {
    config.sendPacketsTo = "ap";
  });
  afterEach(() => {
    config.sendPacketsTo = defaultRecipient;
  });

  it("sends a request for an event to each of its chairs first, with their own link, and nothing to AP yet", async () => {
    const { log, mailer, files, submit } = await setup();
    const result = await submit("fun run");
    expect(result.chair).toEqual({ event: "Fun Run", sentTo: [LILLIE, NORTON] });
    expect(log.rows[0]).toMatchObject({ status: "Awaiting chair", event: "Fun Run", chair_step: "Waiting", chair_sent_to: `${LILLIE}, ${NORTON}` });
    expect(log.rows[0].chair_sent_at).not.toBe("");
    expect(mailer.to(config.apEmail)).toEqual([]);

    const [toLillie] = mailer.to(LILLIE);
    expect(toLillie.subject).toBe(`Please sign: Fun Run reimbursement for Pat Teacher, $10.00 (${result.requestId})`);
    expect(toLillie.replyTo).toBe(ME);
    expect(toLillie.attachments?.[0].filename).toBe(`${result.requestId}.pdf`);
    expect(toLillie.text).toContain("Fun Run budget: $500.00. Before this request $0.00 was claimed, $500.00 left; after it, $490.00 left.");
    expect(toLillie.text).toContain("The other Fun Run chairs got this email too");
    expect(toLillie.text).not.toContain("Paid from");
    expect(linkIn(toLillie).token).not.toBe(linkIn(mailer.to(NORTON)[0]).token);

    const [toMe] = mailer.to(ME);
    expect(toMe.subject).toContain("is with the Fun Run chair");
    expect(toMe.text).toContain(`went to the Fun Run chairs (${LILLIE}, ${NORTON})`);

    const stored = await loadStoredRequest(files, log.rows[0].request_file_id);
    expect(stored).toMatchObject({ requestId: result.requestId, version: 1, requesterEmail: ME, request: { event: "Fun Run" } });
    expect(stored.packet.chairLine).toMatchObject({ page: 0 });
  }, 30_000);

  it("signing makes a co-signed copy, marks the request Submitted and sends it on to AP", async () => {
    const { log, mailer, files, adapters, submit } = await setup();
    const { requestId, pdfFileId, pageCount } = await submit();
    const original = files.files.get(pdfFileId)!.bytes.slice();
    const link = linkIn(mailer.to(LILLIE)[0]);
    const coChair = linkIn(mailer.to(NORTON)[0]);
    mailer.sent = [];

    const ready = await chairLinkState(requestId, link.token, adapters);
    expect(ready.kind).toBe("ready");
    if (ready.kind === "ready") expect(ready.budget).toMatchObject({ budgetCents: 50000, usedBeforeCents: 0, thisCents: 1000, leftAfterCents: 49000 });

    const result = await sign(adapters, link);
    expect(result.emailed).toBe(true);
    const row = log.rows[0];
    expect(row).toMatchObject({ status: "Submitted", chair_step: "Signed", chair_signed_by: LILLIE, chair_name: "Lillie Coit", chair_note: "Water station", chair_pdf_sha256: result.sha256 });
    const cosigned = files.files.get(row.chair_pdf_file_id)!;
    expect(cosigned.name).toBe(`${requestId}-cosigned.pdf`);
    expect((await PDFDocument.load(cosigned.bytes)).getPageCount()).toBe(pageCount + 1);
    expect(files.files.get(pdfFileId)!.bytes).toEqual(original);

    const [toAp] = mailer.to(config.apEmail);
    expect(toAp.text).toContain("signed by the Fun Run chair");
    expect(toAp.text).toContain(`Signed by the Fun Run chair: Lillie Coit <${LILLIE}>`);
    expect(toAp.text).toContain("Chair's note: Water station");
    expect(toAp.text).toContain(`SHA-256: ${result.sha256}`);
    expect(toAp.attachments?.[0].filename).toBe(`${requestId}-cosigned.pdf`);
    expect(mailer.to(ME)[0].text).toContain("the Fun Run chair signed your request, and it was sent to the PTA's accounts payable team");
    expect(mailer.to(LILLIE)[0].subject).toBe(`Signed: Fun Run reimbursement for Pat Teacher (${requestId})`);

    // The co-chair's link now says it's done.
    expect((await chairLinkState(requestId, coChair.token, adapters)).kind).toBe("signed");
  }, 30_000);

  it("refuses a second signature, a removed chair, and a link for another request", async () => {
    const { mailer, adapters, eventRows, submit } = await setup();
    const { requestId } = await submit();
    const lillie = linkIn(mailer.to(LILLIE)[0]);
    const norton = linkIn(mailer.to(NORTON)[0]);

    eventRows[0] = funRun({ chair_email: NORTON });
    expect((await chairLinkState(requestId, lillie.token, adapters)).kind).toBe("not-chair");
    await expect(sign(adapters, lillie)).rejects.toBeInstanceOf(ChairError);
    expect((await chairLinkState("FY99-001", norton.token, adapters)).kind).toBe("invalid");
    expect((await chairLinkState(requestId, "not-a-token", adapters)).kind).toBe("invalid");

    await sign(adapters, norton, "Emperor Norton");
    expect((await chairLinkState(requestId, norton.token, adapters)).kind).toBe("signed");
    eventRows[0] = funRun();
    await expect(sign(adapters, lillie)).rejects.toThrow(/already signed by Emperor Norton/);
  }, 30_000);

  it("in requester mode, sends the co-signed packet to the requester to forward", async () => {
    config.sendPacketsTo = "requester";
    const { mailer, adapters, submit } = await setup();
    const { requestId } = await submit();
    expect(mailer.to(ME)[0].text).toContain("Don't forward this copy");
    const link = linkIn(mailer.to(LILLIE)[0]);
    mailer.sent = [];
    await sign(adapters, link);
    expect(mailer.to(config.apEmail)).toEqual([]);
    const [toMe] = mailer.to(ME);
    expect(toMe.text).toContain("the Fun Run chair signed your request. The co-signed request is attached, but the portal has not sent it to the PTA.");
    expect(toMe.attachments?.[0].filename).toBe(`${requestId}-cosigned.pdf`);
  }, 30_000);

  it("skips the chair step when the requester chairs the event, or no chair is listed", async () => {
    const chairing = await setup([funRun({ chair_email: `${ME}, ${NORTON}` })]);
    const own = await chairing.submit();
    expect(own.chair).toBeNull();
    expect(chairing.log.rows[0]).toMatchObject({ status: "Submitted", event: "Fun Run", chair_step: "Skipped: requester is a chair", chair_sent_to: "" });
    expect(chairing.mailer.to(NORTON)).toEqual([]);
    expect(chairing.mailer.to(config.apEmail)).toHaveLength(1);

    const unchaired = await setup([funRun({ chair_email: "" })]);
    await unchaired.submit();
    expect(unchaired.log.rows[0]).toMatchObject({ status: "Submitted", chair_step: "Skipped: no chair listed" });
  }, 30_000);

  it("refuses an event that isn't on the active list, before anything is written", async () => {
    const { log, submit } = await setup([funRun({ active: "no" })]);
    await expect(submit()).rejects.toBeInstanceOf(EventError);
    await expect(submit("Book Fair")).rejects.toBeInstanceOf(EventError);
    expect(log.rows).toEqual([]);
  });

  it("lets the requester resend once a day, or at once when the first email never went out", async () => {
    const { log, mailer, adapters, submit } = await setup();
    const { requestId } = await submit();
    const resend = (now?: Date) => resendToChair({ requestId, requesterEmail: ME, linkBase: "https://portal.example", now }, adapters);
    await expect(resend()).rejects.toMatchObject({ problem: "too-soon" });
    await expect(resendToChair({ requestId, requesterEmail: "someone@example.org", linkBase: "x" }, adapters)).rejects.toMatchObject({ problem: "not-found" });

    mailer.sent = [];
    const later = new Date(Date.now() + 25 * 3_600_000);
    expect(await resend(later)).toEqual({ sentTo: [LILLIE, NORTON] });
    expect(mailer.to(LILLIE)[0].subject).toMatch(/^Reminder: please sign/);
    expect(log.rows[0].chair_sent_at).toBe(later.toISOString());

    const failing = await setup();
    failing.mailer.failingFor = [LILLIE, NORTON];
    const result = await failing.submit();
    expect(result.emailed).toBe(false);
    expect(failing.log.rows[0]).toMatchObject({ status: "Awaiting chair", chair_sent_at: "" });
    expect(failing.log.rows[0].notes).toContain("Email to the chair");
    failing.mailer.failingFor = [];
    await expect(resendToChair({ requestId: result.requestId, requesterEmail: ME, linkBase: "x" }, failing.adapters)).resolves.toEqual({ sentTo: [LILLIE, NORTON] });
  }, 30_000);

  it("won't resend once the request has moved on", async () => {
    const { mailer, adapters, submit } = await setup();
    const { requestId } = await submit();
    await sign(adapters, linkIn(mailer.to(LILLIE)[0]));
    await expect(resendToChair({ requestId, requesterEmail: ME, linkBase: "x", now: new Date(Date.now() + 48 * 3_600_000) }, adapters)).rejects.toBeInstanceOf(ResendError);
  }, 30_000);
});
