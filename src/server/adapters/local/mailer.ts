import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "@/server/config";
import type { Mailer } from "@/server/adapters/types";

/**
 * Development stand-in for Gmail. Each message is written to .data/outbox as a
 * JSON file plus its attachments, and the text body is echoed to the server
 * console so sign-in links are easy to find.
 */
export const localMailer: Mailer = {
  async send(message) {
    const outbox = path.join(process.cwd(), config.localDataDir, "outbox");
    await fs.mkdir(outbox, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const slug = message.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    const base = `${stamp}-${slug}`;
    const attachments = [];
    for (const [i, a] of (message.attachments ?? []).entries()) {
      const file = `${base}-${i + 1}-${a.filename}`;
      await fs.writeFile(path.join(outbox, file), a.bytes);
      attachments.push({ filename: a.filename, mimeType: a.mimeType, savedAs: file });
    }
    await fs.writeFile(
      path.join(outbox, `${base}.json`),
      JSON.stringify({ ...message, attachments, sentAt: new Date().toISOString() }, null, 2),
    );
    console.log(`\n[local mailer] To: ${message.to.join(", ")}\nSubject: ${message.subject}\n\n${message.text}\n`);
  },
};
