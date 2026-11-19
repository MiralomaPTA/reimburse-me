import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionRecord, CategoryRow, RequestRow, UserRole } from "@/server/adapters/types";
import { sha256 } from "@/server/hash";

const h = vi.hoisted(() => ({
  role: "ap" as UserRole | null,
  rows: [] as RequestRow[],
  files: new Map<string, Uint8Array>(),
  categories: [] as CategoryRow[],
  actions: [] as ActionRecord[],
}));

vi.mock("@/server/auth/session", () => ({
  getApprovedSession: async () => (h.role ? { email: "treasurer@example.org", user: { email: "treasurer@example.org", role: h.role } } : null),
}));
vi.mock("@/server/adapters", () => ({
  getAdapters: async () => ({
    log: {
      get: async (id: string) => h.rows.find((r) => r.request_id === id) ?? null,
      list: async () => [...h.rows],
      update: async (id: string, patch: Partial<RequestRow>) => {
        const i = h.rows.findIndex((r) => r.request_id === id);
        h.rows[i] = { ...h.rows[i], ...patch };
      },
    },
    files: {
      getFileBytes: async (id: string) => {
        const bytes = h.files.get(id);
        if (!bytes) throw new Error(`no file ${id}`);
        return bytes;
      },
    },
    categories: { list: async () => h.categories },
    actions: { append: async (record: ActionRecord) => void h.actions.push(record), listFor: async () => [] },
  }),
}));

import { GET as pdf } from "@/app/ap/[id]/pdf/route";
import { GET as exportCsv } from "@/app/ap/export/route";
import { POST as saveCategory } from "@/app/api/ap/[id]/category/route";
import { apRow } from "./support";

const bytes = (text: string) => new TextEncoder().encode(text);
const getPdf = (query: string) =>
  pdf(new NextRequest(`https://portal.example/ap/FY27-001/pdf?${query}`), { params: Promise.resolve({ id: "FY27-001" }) } as RouteContext<"/ap/[id]/pdf">);
const post = (category: string) => {
  const body = new FormData();
  body.set("category", category);
  return saveCategory(new NextRequest("https://portal.example/api/ap/FY27-001/category", { method: "POST", body }), {
    params: Promise.resolve({ id: "FY27-001" }),
  } as RouteContext<"/api/ap/[id]/category">);
};

beforeEach(() => {
  h.role = "ap";
  h.files = new Map([
    ["signed-v1", bytes("v1")],
    ["signed-v2", bytes("v2")],
    ["cosigned-v2", bytes("v2 cosigned")],
  ]);
  h.rows = [
    apRow({
      version: 2,
      pdf_file_id: "signed-v2",
      pdf_sha256: sha256(bytes("v2")),
      chair_pdf_file_id: "cosigned-v2",
      chair_pdf_sha256: sha256(bytes("v2 cosigned")),
      previous_pdf_file_ids: "signed-v1",
    }),
    apRow({ request_id: "FY26-050", status: "Paid", purpose: "Last year" }),
  ];
  h.categories = [{ name: "Supplies", active: "", order: "" }];
  h.actions = [];
});

describe("AP's packets", () => {
  it("are served to AP: the current version's, and an earlier version's as the requester signed it", async () => {
    const signed = await getPdf("file=signed");
    expect(signed.status).toBe(200);
    expect(signed.headers.get("Content-Disposition")).toContain("FY27-001-v2.pdf");
    expect(new Uint8Array(await signed.arrayBuffer())).toEqual(bytes("v2"));
    const cosigned = await getPdf("file=cosigned");
    expect(cosigned.headers.get("Content-Disposition")).toContain("FY27-001-v2-cosigned.pdf");
    const first = await getPdf("file=signed&v=1");
    expect(first.headers.get("Content-Disposition")).toContain("FY27-001.pdf");
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(bytes("v1"));
  });

  it("aren't served to anyone else, or for a file the row doesn't name", async () => {
    h.role = "teacher";
    expect((await getPdf("file=signed")).status).toBe(404);
    h.role = null;
    expect((await getPdf("file=signed")).status).toBe(404);
    h.role = "admin";
    expect((await getPdf("file=signed")).status).toBe(200);
    expect((await getPdf("file=authorized")).status).toBe(404); // not a mailed check
    expect((await getPdf("file=cosigned&v=1")).status).toBe(404); // earlier versions keep only the requester-signed packet
    expect((await getPdf("file=signed&v=3")).status).toBe(404);
    expect((await getPdf("file=signed&v=0")).status).toBe(404);
    expect((await getPdf("file=__proto__")).status).toBe(404);
  });

  it("refuses a file that doesn't match the hash the row recorded", async () => {
    h.files.set("cosigned-v2", bytes("changed"));
    const response = await getPdf("file=cosigned");
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("Don't pay from it");
  });
});

describe("the CSV export", () => {
  it("gives AP the requests the filters show", async () => {
    const response = await exportCsv(new NextRequest("https://portal.example/ap/export?status=Paid"));
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="reimbursements-\d{4}-\d{2}-\d{2}\.csv"$/);
    const lines = (await response.text()).trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1].startsWith("FY26-050,Paid,")).toBe(true);
  });

  it("is refused to anyone who isn't AP", async () => {
    h.role = "requester";
    expect((await exportCsv(new NextRequest("https://portal.example/ap/export"))).status).toBe(404);
  });
});

describe("saving a category", () => {
  it("saves AP's choice and goes back to the request", async () => {
    const response = await post("Supplies");
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/ap/FY27-001?saved=category");
    expect(h.rows[0].budget_category).toBe("Supplies");
    expect(h.actions).toEqual([expect.objectContaining({ request_id: "FY27-001", action: "category", by: "treasurer@example.org", note: "Supplies" })]);
  });

  it("says why when the category isn't offered", async () => {
    expect((await post("Made up")).headers.get("Location")).toBe("/ap/FY27-001?category=unknown");
    expect(h.rows[0].budget_category).toBe("");
  });

  it("sends anyone who isn't AP away without saving", async () => {
    h.role = "teacher";
    expect((await post("Supplies")).headers.get("Location")).toBe("/requests");
    h.role = null;
    expect((await post("Supplies")).headers.get("Location")).toBe("/?next=%2Fap%2FFY27-001");
    expect(h.rows[0].budget_category).toBe("");
    expect(h.actions).toEqual([]);
  });
});
