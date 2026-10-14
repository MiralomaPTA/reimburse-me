import { describe, expect, it } from "vitest";
import { buildMime } from "@/server/adapters/google/mailer";

describe("buildMime", () => {
  it("builds a multipart message with a base64 attachment", () => {
    const mime = buildMime({
      to: ["ap@example.org"],
      cc: ["jane@example.org"],
      subject: "Reimbursement request FY27-042 – Jane",
      text: "Hello\nthere",
      attachments: [{ filename: "FY27-042.pdf", mimeType: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.7 fake") }],
    });
    expect(mime).toContain("To: ap@example.org");
    expect(mime).toContain("Cc: jane@example.org");
    expect(mime).toContain("Subject: =?UTF-8?B?"); // non-ASCII dash gets encoded
    expect(mime).toContain('Content-Disposition: attachment; filename="FY27-042.pdf"');
    expect(mime).toContain(Buffer.from("%PDF-1.7 fake").toString("base64"));
    expect(mime.trim().endsWith("--")).toBe(true);
  });
});
