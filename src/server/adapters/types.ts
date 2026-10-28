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
  /** The request this receipt was moved into, or "" while it still sits in pending/. A receipt is used once. */
  attachedTo: string;
}

export interface UploadSession {
  /** The browser PUTs the file body to this URL and gets back JSON with the file `id`. */
  uploadUrl: string;
}

export interface FileStore {
  /**
   * Start an upload the browser completes directly (no file bytes pass through the app).
   * `origin` is the browser's origin (from the request's Origin header), needed for
   * CORS on a direct upload to Drive. The returned URL may be relative.
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
  /** "mail" is only on rows from before pickup replaced mailing the check. */
  check_delivery: "pickup" | "mailbox" | "mail";
  /** Only filled on "mail" rows; new rows leave both empty so the Sheet columns keep their places. */
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
  /**
   * Which stipend the requester chose to pay this from: "Classroom stipend",
   * "Grade 2 stipend", "Field trip", "Stipend" or "Not from a stipend". Blank
   * when they had none to choose from. AP may correct it in the Sheet.
   */
  funding: string;
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
  "funding",
];

export interface RequestLog {
  /** Highest sequence number already used for IDs starting with `prefix` (0 if none). */
  maxSequence(prefix: string): Promise<number>;
  append(row: RequestRow): Promise<void>;
  get(requestId: string): Promise<RequestRow | null>;
  listByEmail(email: string): Promise<RequestRow[]>;
  /** Every request; shared stipends add up across requesters. */
  list(): Promise<RequestRow[]>;
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

/** `requester` covers staff and volunteers; `teacher` gets the teacher stipends; `ap` and `admin` are set in the Sheet. */
export type UserRole = "requester" | "teacher" | "ap" | "admin";
export type UserStatus = "pending" | "approved" | "denied";

/**
 * One row in the Users tab: the allow-list for sign-in and, through `role`,
 * the teacher list and the AP list. Admins may edit the tab directly (paste
 * staff emails as approved, set role to teacher, ap or admin).
 */
export interface UserRecord {
  email: string;
  role: UserRole;
  status: UserStatus;
  requested_at: string;
  approved_at: string;
  approved_by: string;
  /** When a sign-in link was last emailed; backs a durable per-address cooldown. */
  last_link_at: string;
  /** When a sign-in link was last used; links issued before this are refused, so each works once. */
  signed_in_at: string;
  note: string;
  /**
   * For a teacher, the grade or grades they teach, e.g. "2", or "1, 2" for a
   * combination class: whose shared stipends they draw on. Blank for a teacher
   * of no one grade (they still get the classroom stipend and field-trip fund)
   * and for non-teachers.
   */
  grade: string;
  /**
   * A non-teacher's own yearly stipend in dollars, e.g. "300"; they choose
   * between it and none. For a teacher it replaces the standard classroom
   * amount. Blank means none.
   */
  stipend: string;
}

export const USER_COLUMNS: (keyof UserRecord)[] = [
  "email",
  "role",
  "status",
  "requested_at",
  "approved_at",
  "approved_by",
  "last_link_at",
  "signed_in_at",
  "note",
  "grade",
  "stipend",
];

export interface UserDirectory {
  get(email: string): Promise<UserRecord | null>;
  /** Insert or replace the row for `record.email` (case-insensitive). */
  upsert(record: UserRecord): Promise<void>;
  /** Pending rows requested at or after `sinceIso`; bounds approval-request spam. */
  countPendingSince(sinceIso: string): Promise<number>;
}

/**
 * One row in the Stipends tab: the PTA-wide amounts for the current fiscal
 * year, edited by the treasurer. `name` is "Classroom" (each teacher's own
 * amount), "Field trip" (one fund the whole school shares) or "Grade TK",
 * "Grade 1", ... (one fund per grade, shared by its teachers).
 */
export interface StipendRow {
  name: string;
  amount: string;
  note: string;
}

export const STIPEND_COLUMNS: (keyof StipendRow)[] = ["name", "amount", "note"];

export interface StipendTable {
  list(): Promise<StipendRow[]>;
}

export interface Adapters {
  files: FileStore;
  log: RequestLog;
  users: UserDirectory;
  stipends: StipendTable;
  mailer: Mailer;
}
