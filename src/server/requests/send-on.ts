import type { MailAttachment, Mailer } from "@/server/adapters/types";
import { config } from "@/server/config";
import { apSubmissionEmail, requesterCopyEmail, requesterPacketEmail, type SubmissionEmailInput } from "@/server/email/templates";

/**
 * Sends a finished packet on, the way config.sendPacketsTo says: to AP with
 * a copy to the requester, or only to the requester, who forwards it. Used
 * for a packet that needs no chair at submission and for a co-signed one
 * once the chair signs. Throws on the first email that fails.
 */
export async function sendPacketOn(input: SubmissionEmailInput, attachment: MailAttachment, mailer: Mailer): Promise<void> {
  if (config.sendPacketsTo === "ap") {
    const ap = apSubmissionEmail(input);
    await mailer.send({ to: [config.apEmail], replyTo: input.requesterEmail, subject: ap.subject, text: ap.text, attachments: [attachment] });
    const copy = requesterCopyEmail(input);
    await mailer.send({ to: [input.requesterEmail], subject: copy.subject, text: copy.text, attachments: [attachment] });
  } else {
    const mail = requesterPacketEmail(input);
    await mailer.send({ to: [input.requesterEmail], subject: mail.subject, text: mail.text, attachments: [attachment] });
  }
}
