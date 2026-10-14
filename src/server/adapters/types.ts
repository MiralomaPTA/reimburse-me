/**
 * The app keeps no data of its own. Everything goes through these three
 * interfaces, backed by Google Drive, Sheets and Gmail in production and by
 * the local filesystem in development.
 */

export interface StoredFileMeta {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** Email of the signed-in user who uploaded it; set server-side, never by the client. */
  uploader: string;
}

export interface UploadSession {
  /** The browser PUTs the file body to this URL and gets back JSON with the file `id`. */
  uploadUrl: string;
}

export interface FileStore {
  /**
   * Start an upload the browser completes directly (no file bytes pass through the app).
   * `origin` is the app's origin, needed for CORS on the direct upload.
   */
  createUploadSession(opts: {
    name: string;
    mimeType: string;
    size: number;
    uploader: string;
    origin: string;
  }): Promise<UploadSession>;
  getFileMeta(id: string): Promise<StoredFileMeta | null>;
  getFileBytes(id: string): Promise<Uint8Array>;
  /** Save a file the app produced (the signed packet). `folderPath` is relative to the root folder. */
  putFile(opts: { name: string; mimeType: string; bytes: Uint8Array; folderPath: string[] }): Promise<{ id: string }>;
  /** Move an uploaded receipt out of the pending area into the request's folder. */
  moveFile(id: string, folderPath: string[]): Promise<void>;
}

export type RequestStatus = "Submitted" | "Approved" | "Returned" | "Paid";

/** One row in the request log. Keys double as the Sheet's header names. */
export interface RequestRow {
  request_id: string;
  status: RequestStatus;
  submitted_at: string;
  requester_email: string;
  payee_name: string;
  pta_position: string;
  phone: string;
  check_delivery: "mail" | "mailbox";
  address: string;
  city_zip: string;
  purpose: string;
  line_count: number;
  receipt_count: number;
  total_expense: string;
  donation_to_pta: string;
  reimbursement_claimed: string;
  pdf_file_id: string;
  pdf_sha256: string;
  signature_type: "typed" | "drawn";
  budget_category: string;
  check_number: string;
  paid_date: string;
  returned_note: string;
  version: number;
  updated_at: string;
  notes: string;
}

export const REQUEST_COLUMNS: (keyof RequestRow)[] = [
  "request_id",
  "status",
  "submitted_at",
  "requester_email",
  "payee_name",
  "pta_position",
  "phone",
  "check_delivery",
  "address",
  "city_zip",
  "purpose",
  "line_count",
  "receipt_count",
  "total_expense",
  "donation_to_pta",
  "reimbursement_claimed",
  "pdf_file_id",
  "pdf_sha256",
  "signature_type",
  "budget_category",
  "check_number",
  "paid_date",
  "returned_note",
  "version",
  "updated_at",
  "notes",
];

export interface RequestLog {
  /** Highest sequence number already used for IDs starting with `prefix` (0 if none). */
  maxSequence(prefix: string): Promise<number>;
  append(row: RequestRow): Promise<void>;
  get(requestId: string): Promise<RequestRow | null>;
  listByEmail(email: string): Promise<RequestRow[]>;
  update(requestId: string, patch: Partial<RequestRow>): Promise<void>;
}

export interface MailAttachment {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface MailMessage {
  to: string[];
  cc?: string[];
  replyTo?: string;
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export interface Adapters {
  files: FileStore;
  log: RequestLog;
  mailer: Mailer;
}
