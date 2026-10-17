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

export const config = {
  /** Public base URL used in emailed links, e.g. https://reimburse.miralomasf.com */
  appUrl: (env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  /** "local" writes to ./.data; "google" uses Drive, Sheets and Gmail as fs@. */
  adapters: adapterKind(),
  apEmail: env.AP_EMAIL ?? "ap@miralomasf.com",
  /** Where "please approve this new user" emails go. */
  approverEmail: env.APPROVER_EMAIL ?? env.AP_EMAIL ?? "ap@miralomasf.com",
  fromEmail: env.FROM_EMAIL ?? "fs@miralomasf.com",
  fromName: env.FROM_NAME ?? "Miraloma PTA Reimbursements",
  localDataDir: env.LOCAL_DATA_DIR ?? ".data",
  sessionDays: 30,
  magicLinkMinutes: 15,
  approvalLinkDays: 7,
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
  };
}
