import sharp from "sharp";
import type { Adapters, EventRow, FileStore, MailMessage, Mailer, RequestLog, RequestRow, StipendRow, StoredFileMeta, UserDirectory, UserRecord } from "@/server/adapters/types";
import type { ApprovedSession } from "@/server/auth/session";
import { maxSequenceIn } from "@/server/requests/submit";
import { requestIdPrefix } from "@/lib/fiscal-year";
import type { RequestInput } from "@/lib/request-schema";

/** In-memory adapters and fixtures shared by the submit and chair tests. */

export interface StoredFile extends StoredFileMeta {
  folderPath: string[];
  bytes: Uint8Array;
}

export class MemoryFiles implements FileStore {
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

export class MemoryLog implements RequestLog {
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

export class MemoryMailer implements Mailer {
  sent: MailMessage[] = [];
  failing = false;
  /** Fail only messages to these addresses. */
  failingFor: string[] = [];
  async send(message: MailMessage) {
    if (this.failing || message.to.some((to) => this.failingFor.includes(to))) throw new Error("Gmail refused");
    this.sent.push(message);
  }
  to(address: string): MailMessage[] {
    return this.sent.filter((m) => m.to.includes(address));
  }
}

export const users: UserDirectory = { async get() { return null; }, async upsert() {}, async countPendingSince() { return 0; } };
export const tab: StipendRow[] = [
  { name: "Classroom", amount: "250", note: "" },
  { name: "Grade 2", amount: "1200", note: "" },
];

export const ME = "pat@example.org";
export const teacher: UserRecord = { email: ME, role: "teacher", status: "approved", requested_at: "", approved_at: "", approved_by: "", last_link_at: "", signed_in_at: "", note: "", grade: "2", stipend: "" };
export const session = (user: UserRecord): ApprovedSession => ({ email: user.email, method: "email-link", signedInAt: "2026-10-16T19:00:00.000Z", user });
export const prefix = requestIdPrefix(new Date());
export const otherRow = (request_id: string): RequestRow => ({ request_id, requester_email: "other@example.org", status: "Submitted", funding: "", reimbursement_claimed: "5.00" }) as RequestRow;

export async function jpeg(): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width: 300, height: 400, channels: 3, background: "#eeeeee" } }).jpeg().toBuffer());
}

/** One line per file, $10, $20, ...; `funding` is one choice for every line, or one per line. */
export function request(fileIds: string[], funding: string | string[] = "none", donationCents = 0, event = ""): RequestInput {
  return {
    payeeName: "Pat Teacher",
    ptaPosition: "Teacher, Room 12",
    phone: "(415) 555-1234",
    checkDelivery: "mailbox",
    purpose: "Art supplies",
    event,
    donationCents,
    items: fileIds.map((fileId, i) => ({
      description: `Item ${i + 1}`,
      amountCents: 1000 * (i + 1),
      receipts: [{ fileId, name: `${fileId}.jpg`, mimeType: "image/jpeg" as const }],
      funding: Array.isArray(funding) ? funding[i] : funding,
    })),
  };
}

export function world() {
  const files = new MemoryFiles();
  const log = new MemoryLog();
  const mailer = new MemoryMailer();
  const eventRows: EventRow[] = [];
  const adapters: Adapters = { files, log, mailer, users, stipends: { async list() { return tab; } }, events: { async list() { return eventRows; } } };
  return { files, log, mailer, adapters, eventRows };
}

