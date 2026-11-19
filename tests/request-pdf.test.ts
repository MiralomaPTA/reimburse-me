import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestRow } from "@/server/adapters/types";
import { sha256 } from "@/server/hash";

const h = vi.hoisted(() => ({
  rows: [] as RequestRow[],
  files: new Map<string, Uint8Array>(),
}));

vi.mock("@/server/auth/session", () => ({ getApprovedSession: async () => ({ email: "pat@example.org" }) }));
vi.mock("@/server/adapters", () => ({
  getAdapters: async () => ({
    log: { get: async (id: string) => h.rows.find((r) => r.request_id === id) ?? null },
    files: { getFileBytes: async (id: string) => h.files.get(id)! },
  }),
}));

import { GET } from "@/app/requests/[id]/pdf/route";

const SIGNED = new Uint8Array([1]);
const CO_SIGNED = new Uint8Array([2]);
const AUTHORIZED = new Uint8Array([3]);

const open = (id = "FY27-042") => GET(new Request(`https://portal.example/requests/${id}/pdf`) as never, { params: Promise.resolve({ id }) } as never);
const filename = (response: Response) => response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1];

describe("the requester's PDF", () => {
  beforeEach(() => {
    h.files = new Map([
      ["signed", SIGNED],
      ["co-signed", CO_SIGNED],
      ["authorized", AUTHORIZED],
    ]);
    h.rows = [
      {
        request_id: "FY27-042",
        requester_email: "pat@example.org",
        version: 1,
        check_delivery: "mail",
        status: "Submitted",
        signers_step: "Signed",
        pdf_file_id: "signed",
        chair_pdf_file_id: "co-signed",
        authorized_pdf_file_id: "authorized",
        authorized_pdf_sha256: sha256(AUTHORIZED),
        authorized_sent_at: "",
        authorized_send_error: "",
      } as unknown as RequestRow,
    ];
  });

  it("is the co-signed packet, not the authorized one, until AP has it", async () => {
    expect(filename(await open())).toBe("FY27-042-cosigned.pdf");
    h.rows[0].authorized_send_error = "Gmail refused";
    expect(filename(await open())).toBe("FY27-042-cosigned.pdf");
  });

  it("is the authorized packet once AP has it, checked against its hash", async () => {
    h.rows[0].authorized_sent_at = "2026-11-18T10:00:00Z";
    const response = await open();
    expect(filename(response)).toBe("FY27-042-authorized.pdf");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(AUTHORIZED);

    h.files.set("authorized", new Uint8Array([9]));
    const tampered = await open();
    expect(tampered.status).toBe(409);
    expect(await tampered.text()).toContain("doesn't match the record");
  });
});
