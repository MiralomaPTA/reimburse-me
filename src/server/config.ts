/**
 * Runtime configuration, read once from environment variables.
 * See .env.example for the full list and README.md for how to fill it in.
 */

import { MAX_UPLOAD_BYTES } from "@/lib/request-schema";

const env = process.env;

function required(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const isProduction = env.NODE_ENV === "production";

export type AdapterKind = "local" | "google";

/**
 * Only the two exact spellings are accepted. A typo must not quietly select
 * the local adapter, which on Vercel would write to the function's disk and
 * lose every request while looking like success.
 */
function adapterKind(): AdapterKind {
  const value = env.ADAPTERS ?? "local";
  if (value === "local" || value === "google") return value;
  throw new Error(`ADAPTERS must be "local" or "google", not "${value}"`);
}

export type PacketRecipient = "requester" | "ap";

/**
 * Who gets the signed packet. "requester" (the default while the portal is
 * being tried out) emails it only to the person who signed, who forwards it to
 * AP by hand; "ap" emails AP directly and sends the requester a copy. As with
 * ADAPTERS, a typo must not quietly pick either one.
 */
function packetRecipient(): PacketRecipient {
  const value = env.SEND_PACKETS_TO ?? "requester";
  if (value === "requester" || value === "ap") return value;
  throw new Error(`SEND_PACKETS_TO must be "requester" or "ap", not "${value}"`);
}

export type MailedChecks = "off" | "pilot" | "everyone";

/**
 * Who is offered "Mail it to me". "pilot" (the default): only accounts whose
 * Users row says `mailed_checks` = yes. "everyone": every account not set to
 * no. "off": nobody, whatever the rows say. A typo must not quietly offer
 * mailing to everyone, or to no one.
 */
function mailedChecks(): MailedChecks {
  const value = (env.MAILED_CHECKS ?? "").trim().toLowerCase() || "pilot";
  if (value === "off" || value === "pilot" || value === "everyone") return value;
  throw new Error(`MAILED_CHECKS must be "off", "pilot" or "everyone", not "${env.MAILED_CHECKS}"`);
}

const list = (value: string | undefined) =>
  String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

const ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

/**
 * The board's check signers, each by their own address: every one is emailed
 * a link of their own for a mailed check, and any two of them sign its FO10.
 * Refuses an entry that isn't an address, the same address twice, or one of
 * the app's shared mailboxes, where whoever reads the link could sign with it.
 */
export function parseCheckSigners(value: string | undefined, shared: string[]): string[] {
  const signers = list(value).map((entry) => entry.toLowerCase());
  for (const signer of signers) {
    if (!ADDRESS.test(signer)) throw new Error(`CHECK_SIGNERS has "${signer}", which isn't an email address. List each check signer's own address, separated by commas.`);
  }
  const twice = signers.find((signer, i) => signers.indexOf(signer) !== i);
  if (twice) throw new Error(`CHECK_SIGNERS lists ${twice} twice. Each check signer is listed once, by their own address.`);
  const mailbox = signers.find((signer) => shared.some((s) => s.trim().toLowerCase() === signer));
  if (mailbox) {
    throw new Error(`CHECK_SIGNERS includes ${mailbox}, which is AP_EMAIL, APPROVER_EMAIL or FROM_EMAIL. A signing link sent to a shared mailbox could be used by anyone who reads it.`);
  }
  return signers;
}

/**
 * The PTA accounts bill pay can draw from, by nickname or last four digits
 * ("Bill pay checking ••1234"). The first is the default. Refuses an entry
 * with more than four digits in a row, which looks like a full account number:
 * the app keeps none.
 */
export function parseBillPayAccounts(value: string | undefined): string[] {
  const accounts = list(value);
  const full = accounts.find((account) => /\d{5,}/.test(account));
  if (full) throw new Error(`BILL_PAY_ACCOUNTS has "${full}", which looks like a full account number. Use a nickname or the last four digits, like "Bill pay checking ••1234".`);
  return accounts;
}

const apEmail = env.AP_EMAIL ?? "ap@miralomasf.com";
const approverEmail = env.APPROVER_EMAIL ?? env.AP_EMAIL ?? "ap@miralomasf.com";
const fromEmail = env.FROM_EMAIL ?? "fs@miralomasf.com";

export const config = {
  /** Public base URL used in emailed links, e.g. https://reimburse.miralomasf.com */
  appUrl: (env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  /** "local" writes to ./.data; "google" uses Drive, Sheets and Gmail as fs@. */
  adapters: adapterKind(),
  /** The PTA's accounts payable address: where packets go when sendPacketsTo is "ap", and the contact shown to requesters. */
  apEmail,
  /** "requester": only the signer gets the packet, to forward to AP by hand. "ap": AP gets it, the signer a copy. */
  sendPacketsTo: packetRecipient(),
  /** Where "please approve this new user" emails go. */
  approverEmail,
  fromEmail,
  fromName: env.FROM_NAME ?? "Miraloma PTA Reimbursements",
  localDataDir: env.LOCAL_DATA_DIR ?? ".data",
  sessionDays: 30,
  magicLinkMinutes: 15,
  approvalLinkDays: 7,
  /** How long the link in an event chair's signature request works. */
  chairLinkDays: 14,
  /** The requester's "Resend to the chair" works once in this many hours. */
  chairResendHours: 24,
  /** The check signers' own addresses (CHECK_SIGNERS). Mailing is offered only when this and billPayAccounts are both set. */
  checkSigners: parseCheckSigners(env.CHECK_SIGNERS, [apEmail, approverEmail, fromEmail]),
  /** The PTA accounts bill pay can draw from (BILL_PAY_ACCOUNTS); the first is the default. */
  billPayAccounts: parseBillPayAccounts(env.BILL_PAY_ACCOUNTS),
  /** Who is offered "Mail it to me" (MAILED_CHECKS): "off", "pilot" or "everyone". */
  mailedChecks: mailedChecks(),
  /** How long the link in a check signer's email works, for that signer, request and version. */
  signerLinkDays: 14,
  /** The requester's "Resend to the check signers" works once in this many hours. */
  signerResendHours: 24,
  /** Durable per-address gap between sign-in emails. */
  linkCooldownSeconds: 60,
  /** New pending access requests allowed per 24 hours; bounds approver inbox and Sheet growth. */
  maxNewPendingPerDay: 20,
  maxUploadBytes: MAX_UPLOAD_BYTES,
  maxReceiptsPerRequest: 20,
  timeZone: "America/Los_Angeles",
  isProduction,
};

/** Signs sessions and sign-in links. Read lazily so a production build without env vars still compiles. */
export function sessionSecret(): string {
  if (!isProduction) return env.SESSION_SECRET || "dev-only-secret-change-me";
  const secret = required("SESSION_SECRET");
  if (Buffer.byteLength(secret) < 32) {
    throw new Error("SESSION_SECRET must be at least 32 bytes; generate one with: openssl rand -base64 48");
  }
  return secret;
}

/** Google settings are only read when ADAPTERS=google, so a local dev box needs none of them. */
export function googleConfig() {
  // Vercel env vars keep literal "\n" in multi-line secrets; turn them back into newlines.
  const privateKey = required("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  return {
    serviceAccountEmail: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    privateKey,
    /** The Workspace user the service account acts as (domain-wide delegation). */
    impersonate: env.GOOGLE_IMPERSONATE_EMAIL ?? config.fromEmail,
    rootFolderId: required("GOOGLE_DRIVE_ROOT_FOLDER_ID"),
    spreadsheetId: required("GOOGLE_SHEET_ID"),
    sheetName: env.GOOGLE_SHEET_NAME ?? "Requests",
    usersSheetName: env.GOOGLE_USERS_SHEET_NAME ?? "Users",
    stipendsSheetName: env.GOOGLE_STIPENDS_SHEET_NAME ?? "Stipends",
    eventsSheetName: env.GOOGLE_EVENTS_SHEET_NAME ?? "Events",
    signaturesSheetName: env.GOOGLE_SIGNATURES_SHEET_NAME ?? "Signatures",
    categoriesSheetName: env.GOOGLE_CATEGORIES_SHEET_NAME ?? "Categories",
    actionsSheetName: env.GOOGLE_ACTIONS_SHEET_NAME ?? "Actions",
  };
}
