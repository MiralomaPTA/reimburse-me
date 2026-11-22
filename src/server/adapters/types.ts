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

/**
 * "Awaiting chair": signed by the requester, waiting for the event chair's
 * signature before it goes on. "Awaiting signers": a mailed check, waiting for
 * two of the PTA's check signers to sign its FO10 before it goes to AP.
 * "Check written": AP wrote the check (or set up the bill pay payment) and it
 * hasn't gone out yet; a paper check is waiting for its second signature.
 */
export type RequestStatus = "Awaiting chair" | "Awaiting signers" | "Submitted" | "Approved" | "Check written" | "Returned" | "Paid";

/**
 * Where a request stands with its event chair. Blank when it isn't for an
 * event. The skips say why the VP/Chairman line stayed blank.
 */
export type ChairStep = "" | "Waiting" | "Signed" | "Sent back" | "Skipped: requester is a chair" | "Skipped: no chair listed";

/** Where a mailed check stands with the PTA's check signers. Blank for a check left in a mailbox or picked up, and for a mailed one still with its chair. */
export type SignersStep = "" | "Waiting" | "1 of 2 signed" | "Signed" | "Sent back";

/** One row in the request log. Keys double as the Sheet's header names. */
export interface RequestRow {
  request_id: string;
  status: RequestStatus;
  submitted_at: string;
  requester_email: string;
  payee_name: string;
  pta_position: string;
  phone: string;
  /** "mail": sent by the bank's bill pay once two check signers sign its FO10 (and on rows from before pickup replaced mailing). */
  check_delivery: "pickup" | "mailbox" | "mail";
  /**
   * Only filled on "mail" rows, for display: the street address, and the city,
   * state and ZIP. The FO10 and AP go by the request's JSON, never these, since
   * the Sheet can be edited.
   */
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
  /** The PTA event the request is for, as named in the Events tab; blank when it isn't for one. */
  event: string;
  chair_step: ChairStep;
  /** The chair addresses the signature request reached, comma-separated. A chair whose email failed isn't listed until a resend reaches them. */
  chair_sent_to: string;
  /** When the chair email last went out (at submit or on resend); blank if it never did. */
  chair_sent_at: string;
  /** The address that signed as chair, the name they signed under, and when. */
  chair_signed_by: string;
  chair_name: string;
  chair_signed_at: string;
  /** The chair's optional note to AP, sent with the co-signed packet. */
  chair_note: string;
  /** Where the chair signed from. Here for AP only, never on the countersignature page, which the requester gets. */
  chair_ip: string;
  chair_user_agent: string;
  /** The co-signed packet: the requester-signed one with the chair's signature and a countersignature page. */
  chair_pdf_file_id: string;
  chair_pdf_sha256: string;
  /** The request's content as JSON, saved beside the packet at every submission (`FY27-042.json`). */
  request_file_id: string;
  /**
   * Held for a few seconds while the app changes the request in a way that
   * mustn't happen twice at once (a chair signing, a resend): "<expires ISO>
   * <id>". Blank otherwise. One left behind by a crash expires on its own and
   * is safe to clear by hand.
   */
  lock: string;
  /** Mailed checks only, from here down. */
  signers_step: SignersStep;
  /** The check signers the signing emails reached, comma-separated. */
  signers_sent_to: string;
  /** When those emails last went out: at the start, after the first signature, or on resend. */
  signers_sent_at: string;
  /** The first check signer: the address their link was sent to, the name they signed under, when, and their note to AP. */
  signer_1_email: string;
  signer_1_name: string;
  signer_1_signed_at: string;
  signer_1_note: string;
  signer_2_email: string;
  signer_2_name: string;
  signer_2_signed_at: string;
  signer_2_note: string;
  /** The values on the signed FO10, set by the first signer and locked after. */
  budget_account: string;
  payment_account: string;
  /** The FO10 with the first signature on it, and its hash. */
  fo10_file_id: string;
  fo10_sha256: string;
  /** The authorized packet: the FO10 signed by both, the packet they authorized, and an authorization page. */
  authorized_pdf_file_id: string;
  authorized_pdf_sha256: string;
  /** When the authorized packet's email reached AP; blank until it does. */
  authorized_sent_at: string;
  /** Why the last try to email AP the authorized packet failed; blank otherwise. Only then can the requester send it again. */
  authorized_send_error: string;
  /**
   * The last return, from whoever sent the request back: when, and the address
   * of the chair, check signer or AP member. `returned_note` says why. Kept
   * after the requester re-signs, so the Sheet shows what the new version answers.
   */
  returned_at: string;
  returned_by: string;
  /** The requester-signed packets of earlier versions, oldest first, comma-separated. `pdf_file_id` is the current version's. */
  previous_pdf_file_ids: string;
  /**
   * AP's steps on this version (Phase 2b), each blank until it happens and
   * cleared when the requester signs a new version. `check_number` and
   * `check_date` (YYYY-MM-DD) are the check's, or a bill pay payment's bank
   * confirmation and the day it was set up; a return clears them, and the
   * Actions tab keeps the voided number. `paid_date` is the day it went out.
   */
  approved_at: string;
  approved_by: string;
  check_date: string;
  check_written_by: string;
  paid_by: string;
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
  "event",
  "chair_step",
  "chair_sent_to",
  "chair_sent_at",
  "chair_signed_by",
  "chair_name",
  "chair_signed_at",
  "chair_note",
  "chair_ip",
  "chair_user_agent",
  "chair_pdf_file_id",
  "chair_pdf_sha256",
  "request_file_id",
  "lock",
  "signers_step",
  "signers_sent_to",
  "signers_sent_at",
  "signer_1_email",
  "signer_1_name",
  "signer_1_signed_at",
  "signer_1_note",
  "signer_2_email",
  "signer_2_name",
  "signer_2_signed_at",
  "signer_2_note",
  "budget_account",
  "payment_account",
  "fo10_file_id",
  "fo10_sha256",
  "authorized_pdf_file_id",
  "authorized_pdf_sha256",
  "authorized_sent_at",
  "authorized_send_error",
  "returned_at",
  "returned_by",
  "previous_pdf_file_ids",
  "approved_at",
  "approved_by",
  "check_date",
  "check_written_by",
  "paid_by",
];

export interface RequestLog {
  /** Highest sequence number already used for IDs starting with `prefix` (0 if none). */
  maxSequence(prefix: string): Promise<number>;
  append(row: RequestRow): Promise<void>;
  get(requestId: string): Promise<RequestRow | null>;
  listByEmail(email: string): Promise<RequestRow[]>;
  /** Every request; shared stipends add up across requesters. */
  list(): Promise<RequestRow[]>;
  /**
   * Writes only the cells `patch` names, so two writers changing different
   * columns of a row (a signer, a resend, AP in the Sheet) can't undo each
   * other.
   */
  update(requestId: string, patch: Partial<RequestRow>): Promise<void>;
  /**
   * Applies `patch` only if the row, as read just before the write, passes
   * `condition`; says whether it did. The Sheet has no compare-and-set, so
   * this narrows the gap between checking and writing to one write, without
   * closing it: see server/requests/lock.ts for what closes it.
   */
  updateIf(requestId: string, condition: (row: RequestRow) => boolean, patch: Partial<RequestRow>): Promise<boolean>;
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
  /**
   * Whether this account is offered "Mail it to me": "yes", "no", or blank to
   * follow MAILED_CHECKS (not offered during the pilot, offered once it's
   * "everyone"). Set by the admin in the Sheet.
   */
  mailed_checks: string;
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
  "mailed_checks",
];

export interface UserDirectory {
  get(email: string): Promise<UserRecord | null>;
  /** Insert or replace the row for `record.email` (case-insensitive). For a new row: it rewrites every cell. */
  upsert(record: UserRecord): Promise<void>;
  /**
   * Writes only the cells `patch` names in `email`'s row, so a cell the admin
   * changed in the Sheet since it was read (`mailed_checks`, say) is kept.
   */
  update(email: string, patch: Partial<UserRecord>): Promise<void>;
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

/**
 * One row in the Events tab: a PTA event and its chair, kept current by the
 * admin. A request for the event goes to the chair to sign the form's
 * VP/Chairman line before it goes on to AP.
 */
export interface EventRow {
  /** "Fun Run": shown in the form's event list and printed beside the VP/Chairman line. At most EVENT_NAME_MAX characters; a longer one is ignored. */
  name: string;
  /** One or more addresses, comma-separated; any one of them may sign. */
  chair_email: string;
  /** Optional other words for the event, comma-separated, used to guess it from a request's description. */
  aliases: string;
  /**
   * Optional: this fiscal year's budget in dollars, e.g. "500". The chair sees
   * what's left of it before and after the request they're signing. Shown,
   * never enforced.
   */
  budget: string;
  /** "no" hides the event from the form; blank or anything else keeps it. */
  active: string;
  note: string;
}

export const EVENT_COLUMNS: (keyof EventRow)[] = ["name", "chair_email", "aliases", "budget", "active", "note"];

export interface EventTable {
  list(): Promise<EventRow[]>;
}

/**
 * One check signer's signature, or their sending the request back, in the
 * Signatures tab. A row is added only once it has gone through, under the
 * request's row lock (server/requests/lock.ts), and never changed after. It
 * keeps what the Requests tab and the packet leave out, like the signer's IP
 * address and browser, and the accounts the first signer locked, which the
 * second signature reads from here rather than from the editable row.
 */
export interface SignatureRecord {
  /** Random; the tab's key. */
  record_id: string;
  request_id: string;
  version: number;
  /** 1 or 2: which Authorized By line. */
  slot: number;
  signer_email: string;
  signer_name: string;
  /** "sent back" is a signer returning the request instead of signing it. */
  state: "signed" | "sent back";
  signed_at: string;
  /** "typed", "drawn", or "send back". */
  method: string;
  ip: string;
  browser: string;
  /** When this signer's link was made: when the email that carried it went out. */
  link_sent_at: string;
  /** Set by the first signature, and the same on the second. */
  budget_account: string;
  payment_account: string;
  /** The packet the signer authorized (co-signed or requester-signed). */
  packet_sha256: string;
  /** The FO10 this signature made: the first-signature FO10, or the fully signed one. */
  fo10_sha256: string;
}

export const SIGNATURE_COLUMNS: (keyof SignatureRecord)[] = [
  "record_id",
  "request_id",
  "version",
  "slot",
  "signer_email",
  "signer_name",
  "state",
  "signed_at",
  "method",
  "ip",
  "browser",
  "link_sent_at",
  "budget_account",
  "payment_account",
  "packet_sha256",
  "fo10_sha256",
];

export interface SignatureLog {
  append(record: SignatureRecord): Promise<void>;
  /** Every record for `requestId`. Nothing depends on their order. */
  listFor(requestId: string): Promise<SignatureRecord[]>;
}

/**
 * One row in the Categories tab: a budget category AP can give a request,
 * edited by the treasurer each fiscal year. An inactive one stays on the
 * requests that have it but leaves the dropdown.
 */
export interface CategoryRow {
  name: string;
  /** "no" takes it out of the dropdown; blank or anything else keeps it. */
  active: string;
  /** Where it sits in the dropdown, smallest first; blank goes last. */
  order: string;
}

export const CATEGORY_COLUMNS: (keyof CategoryRow)[] = ["name", "active", "order"];

export interface CategoryTable {
  list(): Promise<CategoryRow[]>;
}

/**
 * One thing an AP member did to a request, in the Actions tab: the audit
 * trail. A row is added after the change is written and never changed after;
 * the Requests row holds only the latest state.
 */
export interface ActionRecord {
  request_id: string;
  /** "category" for now; Phase 2b adds approve, return, record check and mark sent. */
  action: string;
  /** The signed-in AP member's address. */
  by: string;
  at: string;
  /** For "category", the category given, or blank when it was cleared. */
  note: string;
}

export const ACTION_COLUMNS: (keyof ActionRecord)[] = ["request_id", "action", "by", "at", "note"];

export interface ActionLog {
  append(record: ActionRecord): Promise<void>;
  /** Every record for `requestId`, oldest first. */
  listFor(requestId: string): Promise<ActionRecord[]>;
}

export interface Adapters {
  files: FileStore;
  log: RequestLog;
  signatures: SignatureLog;
  users: UserDirectory;
  stipends: StipendTable;
  events: EventTable;
  categories: CategoryTable;
  actions: ActionLog;
  mailer: Mailer;
}
