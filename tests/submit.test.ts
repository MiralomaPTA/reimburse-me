import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import type { Adapters, FileStore, MailMessage, Mailer, RequestLog, RequestRow, StipendRow, StoredFileMeta, UserDirectory, UserRecord } from "@/server/adapters/types";
import type { ApprovedSession } from "@/server/auth/session";
import { config } from "@/server/config";
import { FundingError } from "@/server/requests/stipends";
import { maxSequenceIn, submitRequest, type SubmitInput } from "@/server/requests/submit";
import { fiscalYearLabel, requestIdPrefix } from "@/lib/fiscal-year";
import type { RequestInput } from "@/lib/request-schema";

interface StoredFile extends StoredFileMeta {
  folderPath: string[];
  bytes: Uint8Array;
}

class MemoryFiles implements FileStore {
  files = new Map<string, StoredFile>();
  failMoves = false;
  private packets = 0;
  add(id: string, uploader: string, bytes: Uint8Array, attachedTo = "") {
    this.files.set(id, { id, name: `${id}.jpg`, mimeType: "image/jpeg", size: bytes.byteLength, uploader, attachedTo, folderPath: attachedTo ? ["requests", "FY", attachedTo] : ["pending"], bytes });
  }
  async createUploadSession(): Promise<never> {
    throw new Error("not used here");
  }
  async getFileMeta(id: string): Promise<StoredFileMeta | null> {
    const f = this.files.get(id);
    return f ? { id: f.id, name: f.name, mimeType: f.mimeType, size: f.size, uploader: f.uploader, attachedTo: f.attachedTo } : null;
  }
  async getFileBytes(id: string) {
    const f = this.files.get(id);
    if (!f) throw new Error(`no file ${id}`);
    return f.bytes;
  }
  async putFile({ name, mimeType, bytes, folderPath }: { name: string; mimeType: string; bytes: Uint8Array; folderPath: string[] }) {
    const id = `packet-${++this.packets}`;
    this.files.set(id, { id, name, mimeType, size: bytes.byteLength, uploader: "app", attachedTo: folderPath[folderPath.length - 1], folderPath, bytes });
    return { id };
  }
  async moveFile(id: string, folderPath: string[]) {
    if (this.failMoves) throw new Error("Drive is down");
    const f = this.files.get(id);
    if (!f) throw new Error(`no file ${id}`);
    f.folderPath = folderPath;
    f.attachedTo = folderPath[folderPath.length - 1];
  }
}

class MemoryLog implements RequestLog {
  rows: RequestRow[] = [];
  /** Runs before each maxSequence read, so a test can slip in a competing row. */
  beforeMaxSequence: () => void = () => {};
  async maxSequence(prefix: string) {
    this.beforeMaxSequence();
    return maxSequenceIn(this.rows, prefix);
  }
  async append(row: RequestRow) {
    this.rows.push(row);
  }
  async get(id: string) {
    return this.rows.find((r) => r.request_id === id) ?? null;
  }
  async listByEmail(email: string) {
    return this.rows.filter((r) => r.requester_email === email);
  }
  async list() {
    return [...this.rows];
  }
  async update(id: string, patch: Partial<RequestRow>) {
    const i = this.rows.findIndex((r) => r.request_id === id);
    if (i === -1) throw new Error(`no row ${id}`);
    this.rows[i] = { ...this.rows[i], ...patch };
  }
}

class MemoryMailer implements Mailer {
  sent: MailMessage[] = [];
  failing = false;
  async send(message: MailMessage) {
    if (this.failing) throw new Error("Gmail refused");
    this.sent.push(message);
  }
}

const users: UserDirectory = { async get() { return null; }, async upsert() {}, async countPendingSince() { return 0; } };
const tab: StipendRow[] = [
  { name: "Classroom", amount: "250", note: "" },
  { name: "Grade 2", amount: "1200", note: "" },
];

const ME = "pat@example.org";
const teacher: UserRecord = { email: ME, role: "teacher", status: "approved", requested_at: "", approved_at: "", approved_by: "", last_link_at: "", signed_in_at: "", note: "", grade: "2", stipend: "" };
const session = (user: UserRecord): ApprovedSession => ({ email: user.email, method: "email-link", signedInAt: "2026-10-16T19:00:00.000Z", user });
const prefix = requestIdPrefix(new Date());
const otherRow = (request_id: string): RequestRow => ({ request_id, requester_email: "other@example.org", status: "Submitted", funding: "", reimbursement_claimed: "5.00" }) as RequestRow;

async function jpeg(): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width: 300, height: 400, channels: 3, background: "#eeeeee" } }).jpeg().toBuffer());
}

function request(fileIds: string[], funding = "none"): RequestInput {
  return {
    payeeName: "Pat Teacher",
    ptaPosition: "Teacher, Room 12",
    phone: "(415) 555-1234",
    checkDelivery: "mailbox",
    address: "",
    cityZip: "",
    purpose: "Art supplies",
    donationCents: 0,
    funding,
    items: fileIds.map((fileId, i) => ({ description: `Item ${i + 1}`, amountCents: 1000 * (i + 1), receipts: [{ fileId, name: `${fileId}.jpg`, mimeType: "image/jpeg" as const }] })),
  };
}

function world() {
  const files = new MemoryFiles();
  const log = new MemoryLog();
  const mailer = new MemoryMailer();
  const adapters: Adapters = { files, log, mailer, users, stipends: { async list() { return tab; } } };
  return { files, log, mailer, adapters };
}

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
