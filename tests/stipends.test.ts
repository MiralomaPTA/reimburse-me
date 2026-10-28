import { describe, expect, it } from "vitest";
import type { RequestRow, RequestStatus, StipendRow, UserRole } from "@/server/adapters/types";
import {
  fundingCell,
  fundingChoice,
  fundingLabel,
  fundingOptions,
  gradeName,
  normalizeGrade,
  parseAmount,
  parseFunding,
  parseFundingCell,
  parseFundingChoice,
  parseGrades,
  stipendGrades,
} from "@/server/requests/stipends";
import { fiscalYearSpan } from "@/lib/fiscal-year";

const now = new Date("2026-10-16T12:00:00-07:00"); // FY27
const tab: StipendRow[] = [
  { name: "Classroom", amount: "250", note: "" },
  { name: "Field trip", amount: "$3,000", note: "" },
  { name: "Grade TK", amount: "800", note: "" },
  { name: "Grade K", amount: "1000", note: "" },
  { name: "Grade 2", amount: "1200", note: "" },
];
const user = (email: string, grade = "", stipend = "", role: UserRole = "requester") => ({ email, role, grade, stipend });
const teacher = (email: string, grade = "", stipend = "") => user(email, grade, stipend, "teacher");
let seq = 0;
const req = (requester_email: string, funding: string, claimed: string, status: RequestStatus = "Submitted", fy = "FY27") =>
  ({ request_id: `${fy}-${String(++seq).padStart(3, "0")}`, requester_email, funding, status, reimbursement_claimed: claimed }) as RequestRow;

describe("parsing hand-typed Sheet values", () => {
  it("reads amounts", () => {
    expect(parseAmount("500")).toBe(50000);
    expect(parseAmount("$1,000.50")).toBe(100050);
    expect(parseAmount("333.3333")).toBe(33333);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount("TBD")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
  });
  it("reads grades", () => {
    expect(normalizeGrade("2nd")).toBe("2");
    expect(normalizeGrade(" k ")).toBe("K");
    expect(normalizeGrade("Kindergarten")).toBe("K");
    expect(normalizeGrade("tk")).toBe("TK");
    expect(normalizeGrade("T-K")).toBe("TK");
    expect(normalizeGrade("Transitional Kindergarten")).toBe("TK");
    expect(normalizeGrade("transitional kindergarden")).toBe("TK");
    expect(normalizeGrade("Grade 3")).toBe("3");
    expect(normalizeGrade(undefined)).toBe("");
  });
  it("reads one grade or several for a combination class", () => {
    expect(parseGrades("2")).toEqual(["2"]);
    expect(parseGrades("1, 2")).toEqual(["1", "2"]);
    expect(parseGrades("TK & K")).toEqual(["TK", "K"]);
    expect(parseGrades("K/1")).toEqual(["K", "1"]);
    expect(parseGrades("Grade 1 and Grade 2; 2nd")).toEqual(["1", "2"]);
    expect(parseGrades("Transitional Kindergarten, Kindergarten")).toEqual(["TK", "K"]);
    expect(parseGrades("")).toEqual([]);
    expect(parseGrades(undefined)).toEqual([]);
  });
  it("round-trips the form's choice values", () => {
    expect(fundingChoice("grade", "2")).toBe("grade:2");
    expect(fundingChoice("classroom", "")).toBe("classroom");
    expect(parseFundingChoice("grade:TK")).toEqual({ key: "grade", grade: "TK" });
    expect(parseFundingChoice("none")).toEqual({ key: "none", grade: "" });
  });
  it("reads funding cells and tab names, and round-trips the labels it writes", () => {
    expect(parseFunding("Grade 2 stipend")).toEqual({ key: "grade", grade: "2" });
    expect(parseFunding("2nd grade")).toEqual({ key: "grade", grade: "2" });
    expect(parseFunding("grade-level k")).toEqual({ key: "grade", grade: "K" });
    expect(parseFunding("Grade TK stipend")).toEqual({ key: "grade", grade: "TK" });
    expect(parseFunding("field trips")).toEqual({ key: "field_trip", grade: "" });
    expect(parseFunding("Not from a stipend")).toEqual({ key: "none", grade: "" });
    expect(parseFunding("")).toEqual({ key: "none", grade: "" });
    for (const key of ["classroom", "field_trip", "stipend", "none"] as const) expect(parseFunding(fundingLabel(key, "")).key).toBe(key);
    expect(parseFunding(fundingLabel("grade", "K"))).toEqual({ key: "grade", grade: "K" });
    expect(parseFunding(fundingLabel("grade", "TK"))).toEqual({ key: "grade", grade: "TK" });
  });
  it("writes a single choice as its label and a split as labels with amounts, and reads both back", () => {
    expect(fundingCell([{ key: "grade", grade: "2", cents: 9000 }])).toBe("Grade 2 stipend");
    const split = fundingCell([
      { key: "classroom", grade: "", cents: 4000 },
      { key: "grade", grade: "2", cents: 5000 },
      { key: "none", grade: "", cents: 1000 },
    ]);
    expect(split).toBe("Classroom stipend: 40.00; Grade 2 stipend: 50.00; Not from a stipend: 10.00");
    expect(parseFundingCell(split, "100.00")).toEqual([
      { key: "classroom", grade: "", cents: 4000 },
      { key: "grade", grade: "2", cents: 5000 },
      { key: "none", grade: "", cents: 1000 },
    ]);
    // A single label counts the whole claim; blank is "none".
    expect(parseFundingCell("Grade 2 stipend", "90.00")).toEqual([{ key: "grade", grade: "2", cents: 9000 }]);
    expect(parseFundingCell("", "90.00")).toEqual([{ key: "none", grade: "", cents: 9000 }]);
    // Hand edits: dollar signs, and a part without an amount takes what is left.
    expect(parseFundingCell("Classroom stipend: $1,000; Grade 2 stipend", "1,250.00")).toEqual([
      { key: "classroom", grade: "", cents: 100000 },
      { key: "grade", grade: "2", cents: 25000 },
    ]);
    expect(parseFundingCell("Classroom stipend; Grade 2 stipend", "100.00").map((p) => p.cents)).toEqual([10000, 0]);
  });
  it("offers TK, K and 1–5 at approval, plus any other grade the tab names", () => {
    expect(stipendGrades([])).toEqual(["TK", "K", "1", "2", "3", "4", "5"]);
    expect(stipendGrades(tab)).toEqual(["TK", "K", "1", "2", "3", "4", "5"]);
    expect(stipendGrades([...tab, { name: "Grade 6", amount: "900", note: "" }])).toEqual(["TK", "K", "1", "2", "3", "4", "5", "6"]);
  });
  it("names grades for people", () => {
    expect(["TK", "K", "3"].map(gradeName)).toEqual(["Transitional kindergarten", "Kindergarten", "Grade 3"]);
  });
});

describe("fundingOptions", () => {
  it("asks nothing of a non-teacher without a stipend, whatever their grade cell says", () => {
    expect(fundingOptions(user("x@example.org"), tab, [], now).stipends).toEqual([]);
    expect(fundingOptions(user("x@example.org", "2"), tab, [], now).stipends).toEqual([]);
    expect(fundingOptions(null, tab, [], now).stipends).toEqual([]);
  });

  it("gives an AP member with their own stipend the staff choice", () => {
    expect(fundingOptions(user("ap@example.org", "", "200", "ap"), tab, [], now).stipends.map((s) => s.key)).toEqual(["stipend"]);
  });

  it("gives a combination-class teacher one choice per grade, each shared with that grade's teachers", () => {
    const rows = [
      req("combo@example.org", "Grade 1 stipend", "40.00"),
      req("combo@example.org", "Grade 2 stipend", "60.00"),
      req("g1@example.org", "Grade 1 stipend", "100.00"),
      req("g2@example.org", "Grade 2 stipend", "200.00"),
    ];
    const tabWithGrade1 = [...tab, { name: "Grade 1", amount: "1000", note: "" }];
    const { stipends } = fundingOptions(teacher("combo@example.org", "1, 2"), tabWithGrade1, rows, now);
    expect(stipends.map((s) => [s.id, s.label, s.sharedWith, s.usedCents, s.remainingCents])).toEqual([
      ["classroom", "Classroom stipend", null, 0, 25000],
      ["grade:1", "Grade 1 stipend", "grade 1 teachers", 14000, 86000],
      ["grade:2", "Grade 2 stipend", "grade 2 teachers", 26000, 94000],
      ["field_trip", "Field trip", "all teachers", 0, 300000],
    ]);
  });

  it("gives a TK teacher the TK grade stipend", () => {
    const rows = [req("tk@example.org", "Grade TK stipend", "30.00"), req("k@example.org", "Grade K stipend", "50.00")];
    const grade = fundingOptions(teacher("tk@example.org", "Transitional Kindergarten"), tab, rows, now).stipends.find((s) => s.key === "grade");
    expect(grade).toMatchObject({ label: "Grade TK stipend", sharedWith: "grade TK teachers", amountCents: 80000, usedCents: 3000 });
  });

  it("leaves out the grade stipend for a teacher of no one grade", () => {
    expect(fundingOptions(teacher("art@example.org"), tab, [], now).stipends.map((s) => s.key)).toEqual(["classroom", "field_trip"]);
  });

  it("gives a staff member their own stipend, counting only their own claims", () => {
    const rows = [req("staff@example.org", "Stipend", "40.00", "Paid"), req("other@example.org", "Stipend", "99.00")];
    const [stipend, ...rest] = fundingOptions(user("staff@example.org", "", "300"), tab, rows, now).stipends;
    expect(rest).toEqual([]);
    expect(stipend).toMatchObject({ key: "stipend", label: "Stipend", sharedWith: null, amountCents: 30000, usedCents: 4000, paidCents: 4000, remainingCents: 26000 });
  });

  it("gives a teacher the classroom stipend, their grade's shared stipend and the school-wide field-trip fund", () => {
    const me = "pat@example.org";
    const rows = [
      req(me, "Classroom stipend", "100.00", "Paid"),
      req("lee@example.org", "Classroom stipend", "80.00"), // another teacher's classroom: not mine
      req(me, "Grade 2 stipend", "300.00"),
      req("lee@example.org", "Grade 2 stipend", "500.00"), // same grade: shared
      req("kim@example.org", "Grade K stipend", "70.00"), // other grade
      req("kim@example.org", "Field trip", "900.00"), // any teacher: shared
      req(me, "Grade 2 stipend", "50.00", "Returned"),
      req(me, "Classroom stipend", "60.00", "Paid", "FY26"),
      req(me, "Not from a stipend", "45.00"),
      req(me, "Classroom stipend: 20.00; Grade 2 stipend: 30.00; Not from a stipend: 5.00", "55.00", "Paid"), // split: each part to its own stipend
      req("lee@example.org", "Classroom stipend: 10.00; Field trip: 15.00", "25.00"), // lee's classroom is not mine; the field trip is shared
    ];
    const { fiscalYear, stipends } = fundingOptions(teacher(me, "2nd"), tab, rows, now);
    expect(fiscalYear).toBe("FY27");
    expect(stipends.map((s) => [s.label, s.sharedWith, s.amountCents, s.usedCents, s.paidCents, s.remainingCents])).toEqual([
      ["Classroom stipend", null, 25000, 12000, 12000, 13000],
      ["Grade 2 stipend", "grade 2 teachers", 120000, 83000, 3000, 37000],
      ["Field trip", "all teachers", 300000, 91500, 0, 208500],
    ]);
  });

  it("lets a teacher's own stipend replace the standard classroom amount, and goes negative when over", () => {
    const rows = [req("half@example.org", "Classroom stipend", "150.00")];
    const [classroom] = fundingOptions(teacher("half@example.org", "K", "125"), tab, rows, now).stipends;
    expect(classroom).toMatchObject({ amountCents: 12500, remainingCents: -2500 });
  });

  it("still offers a stipend with no amount set, tracking use without a limit", () => {
    const rows = [req("t@example.org", "Grade 4 stipend", "20.00")];
    const grade = fundingOptions(teacher("t@example.org", "4"), tab, rows, now).stipends.find((s) => s.key === "grade");
    expect(grade).toMatchObject({ label: "Grade 4 stipend", amountCents: null, usedCents: 2000, remainingCents: null });
  });
});

describe("fiscalYearSpan", () => {
  it("names the months a fiscal year covers", () => {
    expect(fiscalYearSpan("FY27")).toBe("July 2026 – June 2027");
  });
});
