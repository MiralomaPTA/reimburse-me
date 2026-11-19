import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestRow, StoredFileMeta } from "@/server/adapters/types";

const ME = "pat@example.org";
const h = vi.hoisted(() => ({
  rows: [] as RequestRow[],
  metas: new Map<string, StoredFileMeta>(),
}));

vi.mock("@/server/auth/session", () => ({ getApprovedSession: async () => ({ email: "pat@example.org" }) }));
vi.mock("@/server/adapters", () => ({
  getAdapters: async () => ({
    log: { get: async (id: string) => h.rows.find((r) => r.request_id === id) ?? null },
    files: { getFileMeta: async (id: string) => h.metas.get(id) ?? null, getFileBytes: async () => new Uint8Array([1]) },
  }),
}));
// The packet itself is covered elsewhere; this is about which receipts the preview may use.
vi.mock("@/server/pdf/build-packet", () => ({ buildPacket: async () => ({ bytes: new Uint8Array([37, 80, 68, 70]), sha256: "", pageCount: 1 }) }));

import { POST } from "@/app/api/requests/preview/route";

const body = JSON.stringify({
  payeeName: "Pat Teacher",
  ptaPosition: "Teacher, Room 12",
  phone: "(415) 555-1234",
  checkDelivery: "mailbox",
  purpose: "Art supplies",
  items: [{ description: "Paint", amountCents: 1000, receipts: [{ fileId: "receipt-of-042", name: "r.jpg", mimeType: "image/jpeg" }] }],
});
const preview = (fix?: string) => POST(new Request(`https://portal.example/api/requests/preview${fix ? `?fix=${fix}` : ""}`, { method: "POST", body }));
const row = (request_id: string, extra: Partial<RequestRow> = {}) => ({ request_id, requester_email: ME, status: "Returned", request_file_id: "json", ...extra }) as RequestRow;

describe("the preview of a fix", () => {
  beforeEach(() => {
    // A receipt already in FY27-042's folder.
    h.metas = new Map([["receipt-of-042", { id: "receipt-of-042", name: "r.jpg", mimeType: "image/jpeg", size: 1, uploader: ME, attachedTo: "FY27-042" }]]);
    h.rows = [row("FY27-042"), row("FY27-043")];
  });

  it("may use the receipts of the requester's own returned request", async () => {
    expect((await preview("FY27-042")).status).toBe(200);
  });

  it("refuses them for a new request, another request, someone else's, or one that isn't returned", async () => {
    const refused = async (fix?: string) => {
      const response = await preview(fix);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("already used in request FY27-042");
    };
    await refused();
    await refused("FY27-043");
    h.rows = [row("FY27-042", { requester_email: "someone@example.org" })];
    await refused("FY27-042");
    h.rows = [row("FY27-042", { status: "Awaiting chair" })];
    await refused("FY27-042");
  });
});
