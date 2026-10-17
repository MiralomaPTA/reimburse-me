import { describe, expect, it } from "vitest";
import { fiscalYearLabel, formatRequestId } from "@/lib/fiscal-year";
import { formatMoney, moneyPlain, parseMoney } from "@/lib/money";
import { safeNextPath } from "@/lib/next-path";
import { requestInputSchema, splitPhone, submitSchema, totals } from "@/lib/request-schema";

describe("money", () => {
  it("parses dollars and cents into integer cents", () => {
    expect(parseMoney("12.5")).toBe(1250);
    expect(parseMoney("$1,234.56")).toBe(123456);
    expect(parseMoney("7")).toBe(700);
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("1.234")).toBeNull();
  });
  it("formats", () => {
    expect(formatMoney(123456)).toBe("$1,234.56");
    expect(formatMoney(5)).toBe("$0.05");
    expect(moneyPlain(123456)).toBe("1234.56");
  });
});

describe("fiscal year", () => {
  it("runs July to June and is named for the year it ends in", () => {
    expect(fiscalYearLabel(new Date("2026-10-14T12:00:00-07:00"))).toBe("FY27");
    expect(fiscalYearLabel(new Date("2026-06-30T12:00:00-07:00"))).toBe("FY26");
    expect(fiscalYearLabel(new Date("2026-07-01T00:30:00-07:00"))).toBe("FY27");
  });
  it("formats sequential ids", () => {
    expect(formatRequestId("FY27-", 42)).toBe("FY27-042");
    expect(formatRequestId("FY27-", 1234)).toBe("FY27-1234");
  });
});

describe("request schema", () => {
  const receipt = { fileId: "abcdefgh12345678", name: "r.jpg", mimeType: "image/jpeg" as const };
  const base = {
    payeeName: "Jane Doe",
    ptaPosition: "Teacher, Room 12",
    phone: "(415) 555-1234",
    checkDelivery: "mailbox" as const,
    purpose: "Art supplies",
    items: [{ description: "Markers", amountCents: 1250, receipts: [receipt] }],
  };

  it("accepts a minimal request and fills defaults", () => {
    const parsed = requestInputSchema.parse(base);
    expect(parsed.donationCents).toBe(0);
    expect(parsed.address).toBe("");
    expect(totals(parsed)).toEqual({ totalCents: 1250, donationCents: 0, reimbursementCents: 1250 });
  });

  it("takes a funding choice, naming the grade for a grade's stipend", () => {
    expect(requestInputSchema.parse(base).funding).toBe("none");
    for (const funding of ["classroom", "grade:2", "grade:TK", "field_trip", "stipend", "none"]) {
      expect(requestInputSchema.safeParse({ ...base, funding }).success).toBe(true);
    }
    for (const funding of ["grade", "grade:", "grade:2nd grade", "budget"]) {
      expect(requestInputSchema.safeParse({ ...base, funding }).success).toBe(false);
    }
  });

  it("requires an address when the check is mailed", () => {
    const result = requestInputSchema.safeParse({ ...base, checkDelivery: "mail" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join("."))).toEqual(expect.arrayContaining(["address", "cityZip"]));
  });

  it("rejects donating more than the total and lines without receipts", () => {
    expect(requestInputSchema.safeParse({ ...base, donationCents: 2000 }).success).toBe(false);
    expect(requestInputSchema.safeParse({ ...base, items: [{ ...base.items[0], receipts: [] }] }).success).toBe(false);
  });

  it("requires consent and a signature to submit", () => {
    expect(submitSchema.safeParse({ request: base, signature: { type: "typed", name: "Jane Doe" }, consent: true }).success).toBe(true);
    expect(submitSchema.safeParse({ request: base, signature: { type: "typed", name: "Jane Doe" }, consent: false }).success).toBe(false);
    expect(submitSchema.safeParse({ request: base, signature: { type: "drawn", pngDataUrl: "data:image/jpeg;base64,xx" }, consent: true }).success).toBe(false);
  });

  it("splits US phone numbers for the form's two boxes", () => {
    expect(splitPhone("(415) 555-1234")).toEqual({ area: "415", number: "555-1234" });
    expect(splitPhone("1-415-555-1234")).toEqual({ area: "415", number: "555-1234" });
    expect(splitPhone("+44 20 7946 0958")).toEqual({ area: "", number: "+44 20 7946 0958" });
  });
});

describe("safeNextPath", () => {
  it("keeps paths on this site and rejects anything a browser could read as another origin", () => {
    expect(safeNextPath("/requests/FY27-001")).toBe("/requests/FY27-001");
    expect(safeNextPath("/requests?page=2")).toBe("/requests?page=2");
    for (const bad of ["//evil.com", "/\\evil.com", "/\\\\evil.com", "https://evil.com", "/\t/evil.com", "/\n/evil.com", "requests", "", undefined, null, 42]) {
      expect(safeNextPath(bad), String(bad)).toBeNull();
    }
  });
});
