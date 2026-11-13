import { afterEach, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { Adapters } from "@/server/adapters/types";
import { config } from "@/server/config";
import { FundingError } from "@/server/requests/stipends";
import { maxSequenceIn, submitRequest, type SubmitInput } from "@/server/requests/submit";
import { fiscalYearLabel } from "@/lib/fiscal-year";
import type { RequestInput } from "@/lib/request-schema";
import { jpeg, ME, otherRow, prefix, request, session, teacher, world } from "./support";
import type { UserRecord } from "@/server/adapters/types";

function submit(adapters: Adapters, req: RequestInput, user = teacher, extra: Partial<SubmitInput> = {}) {
  return submitRequest(
    { request: req, signature: { type: "typed", name: "Pat Teacher" }, session: session(user), ip: "127.0.0.1", userAgent: "vitest", linkBase: "https://portal.example", ...extra },
    adapters,
  );
}

describe("submitRequest", () => {
  const defaultRecipient = config.sendPacketsTo;
  afterEach(() => {
    config.sendPacketsTo = defaultRecipient;
  });

  it("stores the packet, writes the row, moves the receipts and emails AP and the requester", async () => {
    config.sendPacketsTo = "ap";
    const { files, log, mailer, adapters } = world();
    files.add("r1", ME, await jpeg());
    const result = await submit(adapters, request(["r1"], "grade:2"));
    expect(result.requestId).toBe(`${prefix}001`);
    expect(result.emailed).toBe(true);
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0]).toMatchObject({
      request_id: result.requestId,
      status: "Submitted",
      requester_email: ME,
      funding: "Grade 2 stipend",
      reimbursement_claimed: "10.00",
      pdf_file_id: result.pdfFileId,
      pdf_sha256: result.sha256,
      notes: "",
    });
    expect(files.files.get("r1")).toMatchObject({ attachedTo: result.requestId });
    expect(files.files.get(result.pdfFileId)?.folderPath).toEqual(["requests", fiscalYearLabel(new Date()), result.requestId]);
    expect(mailer.sent.map((m) => m.to)).toEqual([[config.apEmail], [ME]]);
    expect(mailer.sent[0].replyTo).toBe(ME);
    expect(mailer.sent[0].text).toContain(`https://portal.example/requests/${result.requestId}`);
    expect(mailer.sent[0].attachments?.[0].filename).toBe(`${result.requestId}.pdf`);
    expect(result.funding.stipends.find((s) => s.id === "grade:2")).toMatchObject({ usedCents: 1000, remainingCents: 119000 });
    expect(mailer.sent[0].text).toContain("Paid from: Grade 2 stipend (shared by grade 2 teachers): $1,200.00, $10.00 claimed including this request, $1,190.00 left");
  }, 30_000);

  it("splits a request between stipends line by line, one receipt on two lines, and records each share", async () => {
    config.sendPacketsTo = "ap";
    const { files, log, mailer, adapters } = world();
    files.add("r1", ME, await jpeg());
    files.add("r2", ME, await jpeg());
    // $10 classroom, $20 grade 2 and $30 unfunded, with $6 donated: $9 + $18 + $27 claimed. Lines 1 and 2 share receipt r1.
    const result = await submit(adapters, request(["r1", "r1", "r2"], ["classroom", "grade:2", "none"], 600));
    expect(log.rows[0]).toMatchObject({
      funding: "Classroom stipend: 9.00; Grade 2 stipend: 18.00; Not from a stipend: 27.00",
      reimbursement_claimed: "54.00",
      line_count: 3,
      receipt_count: 2,
    });
    expect(result.funding.stipends.map((s) => [s.id, s.usedCents])).toEqual([
      ["classroom", 900],
      ["grade:2", 1800],
      ["field_trip", 0],
    ]);
    const text = mailer.sent[0].text;
    expect(text).toContain("1. Item 1 - $10.00 (1 receipt, Classroom stipend)");
    expect(text).toContain("3. Item 3 - $30.00 (1 receipt, Not from a stipend)");
    expect(text).toContain(["Paid from:", "  $9.00 from Classroom stipend: $250.00, $9.00 claimed including this request, $241.00 left", "  $18.00 from Grade 2 stipend (shared by grade 2 teachers): $1,200.00, $18.00 claimed including this request, $1,182.00 left", "  $27.00 from Not from a stipend"].join("\n"));
    const doc = await PDFDocument.load(files.files.get(result.pdfFileId)!.bytes);
    expect(doc.getPageCount()).toBe(5); // form, r1 for line 1, r1 again for line 2, r2, audit
  }, 30_000);

  it("leaves the funding cell blank for a requester with no stipend to choose", async () => {
    const { files, log, mailer, adapters } = world();
    files.add("r1", ME, await jpeg());
    const volunteer: UserRecord = { ...teacher, role: "requester", grade: "" };
    await submit(adapters, request(["r1"]), volunteer);
    expect(log.rows[0].funding).toBe("");
    expect(mailer.sent[0].text).not.toContain("Paid from");
  }, 30_000);

  it("emails only the requester, with the packet to forward, when packets go to the requester", async () => {
    config.sendPacketsTo = "requester";
    const { mailer, files, adapters } = world();
    files.add("r1", ME, await jpeg());
    const result = await submit(adapters, request(["r1"]));
    expect(result.emailed).toBe(true);
    expect(mailer.sent.map((m) => m.to)).toEqual([[ME]]);
    const [mail] = mailer.sent;
    expect(mail.replyTo).toBeUndefined();
    expect(mail.subject).toBe(`Reimbursement request ${result.requestId} - Pat Teacher - $10.00`);
    expect(mail.text).toContain(`forward this email, with the PDF still attached, to the PTA's accounts payable team at ${config.apEmail}`);
    expect(mail.text).toContain(`SHA-256: ${result.sha256}`);
    expect(mail.attachments?.[0].filename).toBe(`${result.requestId}.pdf`);
  }, 30_000);

  it("refuses a stipend the requester doesn't have, before anything is written", async () => {
    const { files, log, adapters } = world();
    files.add("r1", ME, await jpeg());
    await expect(submit(adapters, request(["r1"], "grade:4"))).rejects.toBeInstanceOf(FundingError);
    await expect(submit(adapters, request(["r1", "r1"], ["classroom", "grade:4"]))).rejects.toBeInstanceOf(FundingError);
    expect(log.rows).toEqual([]);
    expect(files.files.get("r1")?.attachedTo).toBe("");
  });

  it("refuses a receipt uploaded by someone else, or already used in another request", async () => {
    const { files, log, adapters } = world();
    files.add("theirs", "other@example.org", await jpeg());
    await expect(submit(adapters, request(["theirs"]))).rejects.toThrow(/does not belong/);
    files.add("used", ME, await jpeg(), `${prefix}007`);
    await expect(submit(adapters, request(["used"]))).rejects.toThrow(`already used in request ${prefix}007`);
    expect(log.rows).toEqual([]);
  });

  it("takes the next number when another submission claims the ID while the packet is being built", async () => {
    const { files, log, adapters } = world();
    files.add("r1", ME, await jpeg());
    log.beforeMaxSequence = () => {
      if (log.rows.length === 0) log.rows.push(otherRow(`${prefix}001`));
    };
    const result = await submit(adapters, request(["r1"]));
    expect(result.requestId).toBe(`${prefix}002`);
    expect(log.rows.map((r) => r.request_id)).toEqual([`${prefix}001`, `${prefix}002`]);
    const doc = await PDFDocument.load(files.files.get(result.pdfFileId)!.bytes);
    expect(doc.getTitle()).toBe(`PTA reimbursement request ${prefix}002`);
  }, 30_000);

  it("keeps the request when the email fails, and says so", async () => {
    const { files, log, mailer, adapters } = world();
    files.add("r1", ME, await jpeg());
    mailer.failing = true;
    const result = await submit(adapters, request(["r1"]));
    expect(result).toMatchObject({ emailed: false, emailError: "Gmail refused" });
    expect(log.rows[0].notes).toBe("Email failed at submission: Gmail refused");
  }, 30_000);

  it("keeps the request when the receipts can't be moved, and notes it on the row", async () => {
    const { files, log, adapters } = world();
    files.add("r1", ME, await jpeg());
    files.failMoves = true;
    const result = await submit(adapters, request(["r1"]));
    expect(result.emailed).toBe(true);
    expect(log.rows[0].notes).toContain("Receipts could not be moved");
    expect(files.files.get("r1")?.attachedTo).toBe("");
  }, 30_000);
});

describe("maxSequenceIn", () => {
  it("finds the highest number for the prefix and ignores other years and odd IDs", () => {
    const rows = ["FY27-003", "FY27-010", "FY26-200", "FY27-abc", "PREVIEW"].map((id) => ({ request_id: id }));
    expect(maxSequenceIn(rows, "FY27-")).toBe(10);
    expect(maxSequenceIn(rows, "FY28-")).toBe(0);
  });
});
