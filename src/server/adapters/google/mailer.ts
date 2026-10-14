import { gmail as gmailApi, type gmail_v1 } from "@googleapis/gmail";
import { config } from "@/server/config";
import { googleAuth } from "@/server/adapters/google/auth";
import type { MailMessage, Mailer } from "@/server/adapters/types";

/** Sends through the Gmail API as fs@ (the delegated user). */

let api: gmail_v1.Gmail | null = null;

function gmail(): gmail_v1.Gmail {
  if (!api) api = gmailApi({ version: "v1", auth: googleAuth() });
  return api;
}

function encodeHeader(value: string): string {
  // RFC 2047 for non-ASCII subjects and names.
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function base64Lines(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/(.{76})/g, "$1\r\n");
}

/** Builds an RFC 5322 message with optional attachments. */
export function buildMime(message: MailMessage): string {
  const boundary = `=_rm_${crypto.randomUUID()}`;
  const from = `${encodeHeader(config.fromName)} <${config.fromEmail}>`;
  const lines = [
    `From: ${from}`,
    `To: ${message.to.join(", ")}`,
    ...(message.cc?.length ? [`Cc: ${message.cc.join(", ")}`] : []),
    ...(message.replyTo ? [`Reply-To: ${message.replyTo}`] : []),
    `Subject: ${encodeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(message.text, "utf8")),
  ];
  for (const a of message.attachments ?? []) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${a.mimeType}; name="${a.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${a.filename}"`,
      "",
      base64Lines(a.bytes),
    );
  }
  lines.push(`--${boundary}--`, "");
  return lines.join("\r\n");
}

export const googleMailer: Mailer = {
  async send(message) {
    const raw = Buffer.from(buildMime(message), "utf8").toString("base64url");
    await gmail().users.messages.send({ userId: "me", requestBody: { raw } });
  },
};
