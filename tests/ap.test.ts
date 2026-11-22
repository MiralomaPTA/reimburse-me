import { describe, expect, it } from "vitest";
import type { CategoryRow, RequestRow } from "@/server/adapters/types";
import { CategoryError, setCategory } from "@/server/ap/category";
import { csvField, CSV_COLUMNS, requestsCsv } from "@/server/ap/csv";
import {
  ageDays,
  categoryChoices,
  earlierPackets,
  filtersQuery,
  fiscalYears,
  formatAge,
  isAp,
  matches,
  oldestFirst,
  parseFilters,
  reachedApAt,
  UNCATEGORIZED,
} from "@/server/ap/dashboard";
import { mailedBeforeBillPay, mailedCheck, mailedChecks, mailedDifferences } from "@/server/ap/mailed";
import { paidLine } from "@/server/email/templates";
import { dayStart } from "@/lib/dates";
import { sha256 } from "@/server/hash";
import type { StoredRequest } from "@/server/requests/stored";
import { apRow, MemoryFiles, request, world } from "./support";

const NOW = new Date("2026-11-19T20:00:00.000Z");
const defaults = parseFilters({});

describe("who sees the AP dashboard", () => {
  it("is AP and admin rows only, however the role cell is typed", () => {
    expect(isAp({ role: "ap" })).toBe(true);
    expect(isAp({ role: "admin" })).toBe(true);
    expect(isAp({ role: " AP " as never })).toBe(true);
    expect(isAp({ role: "teacher" })).toBe(false);
    expect(isAp({ role: "requester" })).toBe(false);
  });
});

describe("a request's age", () => {
  it("counts a Submitted request from when it reached AP: after its chair and its check signers", () => {
    expect(ageDays(apRow(), NOW)).toBe(18);
    const chaired = apRow({ chair_step: "Signed", chair_signed_at: "2026-11-10T17:00:00.000Z" });
    expect(reachedApAt(chaired)?.toISOString()).toBe("2026-11-10T17:00:00.000Z");
    expect(ageDays(chaired, NOW)).toBe(9);
    const mailed = apRow({ check_delivery: "mail", signer_2_signed_at: "2026-11-15T17:00:00.000Z", authorized_sent_at: "2026-11-15T17:01:00.000Z" });
    expect(ageDays(mailed, NOW)).toBe(4);
  });

  it("counts a Returned request from the return, and one waiting for its chair or signers from the last email", () => {
    expect(ageDays(apRow({ status: "Returned", returned_at: "2026-11-18T17:00:00.000Z" }), NOW)).toBe(1);
    // A return from before this version was signed isn't this version's.
    expect(ageDays(apRow({ status: "Returned", returned_at: "2026-10-01T17:00:00.000Z" }), NOW)).toBeNull();
    expect(ageDays(apRow({ status: "Awaiting chair", chair_sent_at: "2026-11-17T17:00:00.000Z" }), NOW)).toBe(2);
    expect(ageDays(apRow({ status: "Awaiting chair" }), NOW)).toBe(18);
    expect(ageDays(apRow({ status: "Awaiting signers", signers_sent_at: "2026-11-19T17:00:00.000Z" }), NOW)).toBe(0);
  });

  it("has no Reached AP while the chair or the signers have it, or after one of them sent it back", () => {
    const chaired = { chair_step: "Signed", chair_signed_at: "2026-11-10T17:00:00.000Z" } as const;
    expect(reachedApAt(apRow({ ...chaired, status: "Awaiting signers", check_delivery: "mail" }))).toBeNull();
    expect(reachedApAt(apRow({ status: "Awaiting chair" }))).toBeNull();
    expect(reachedApAt(apRow({ ...chaired, status: "Returned", signers_step: "Sent back" }))).toBeNull();
    expect(reachedApAt(apRow({ status: "Returned", chair_step: "Sent back" }))).toBeNull();
    // Sent back by AP (a status typed in the Sheet in 2a): it had reached AP.
    expect(reachedApAt(apRow({ ...chaired, status: "Returned" }))?.toISOString()).toBe("2026-11-10T17:00:00.000Z");
    // The age of one still with the signers is unchanged.
    expect(ageDays(apRow({ ...chaired, status: "Awaiting signers" }), NOW)).toBe(9);
  });

  it("counts a written check from its date, and keeps it in the default view: it's the co-signer's to-do list", () => {
    const written = apRow({ status: "Check written", check_number: "1043", check_date: "2026-11-15" });
    expect(ageDays(written, NOW)).toBe(4);
    // A date typed into the Sheet reads too.
    expect(ageDays(apRow({ status: "Check written", check_date: "11/15/2026" }), NOW)).toBe(4);
    expect(matches(written, defaults)).toBe(true);
    expect(matches(written, parseFilters({ status: "Check written" }))).toBe(true);
    expect(matches(apRow(), parseFilters({ status: "Check written" }))).toBe(false);
    // Awaiting signature is the paper checks: a bill pay payment at Check written already has both signatures.
    const awaiting = parseFilters({ status: "awaiting-signature" });
    expect(awaiting.status).toBe("awaiting-signature");
    expect(matches(written, awaiting)).toBe(true);
    expect(matches(apRow({ status: "Check written", check_delivery: "mail", signers_step: "Signed", request_file_id: "j1" }), awaiting)).toBe(false);
  });

  it("counts a check's age in Pacific days: one dated today is waiting since today, even after 4 PM", () => {
    const evening = new Date("2026-11-20T01:00:00.000Z"); // Nov 19, 5 PM in San Francisco
    expect(ageDays(apRow({ status: "Check written", check_date: "2026-11-19" }), evening)).toBe(0);
    expect(dayStart("2026-11-19")?.toISOString()).toBe("2026-11-19T08:00:00.000Z");
    expect(dayStart("2026-07-01")?.toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(dayStart("11/19/2026")).toBeNull();
  });

  it("is blank once Paid, and counts a status typed by hand from reaching AP", () => {
    expect(ageDays(apRow({ status: "Paid" }), NOW)).toBeNull();
    expect(ageDays(apRow({ status: "Check written" as never }), NOW)).toBe(18);
    expect([formatAge(null), formatAge(0), formatAge(1), formatAge(5)]).toEqual(["", "today", "1 day", "5 days"]);
  });
});

describe("the dashboard's filters", () => {
  const rows = [
    apRow({ request_id: "FY27-001", status: "Submitted", payee_name: "Pat Teacher", purpose: "Art supplies" }),
    apRow({ request_id: "FY27-002", status: "Awaiting chair", payee_name: "Sam Volunteer" }),
    apRow({ request_id: "FY27-003", status: "Awaiting signers" }),
    apRow({ request_id: "FY27-004", status: "Returned", requester_email: "kim@example.org" }),
    apRow({ request_id: "FY26-099", status: "Paid", purpose: "Book fair float" }),
    apRow({ request_id: "FY27-005", status: "Approved" }),
  ];
  const ids = (filters: Record<string, string>) => rows.filter((row) => matches(row, parseFilters(filters))).map((r) => r.request_id);

  it("shows what's with AP by default: not Paid, and not still with a chair or the check signers", () => {
    expect(ids({})).toEqual(["FY27-001", "FY27-004", "FY27-005"]);
    expect(ids({ paid: "1" })).toEqual(["FY27-001", "FY27-004", "FY26-099", "FY27-005"]);
  });

  it("filters by status, everything, fiscal year and a search", () => {
    expect(ids({ status: "Awaiting chair" })).toEqual(["FY27-002"]);
    expect(ids({ status: "Paid" })).toEqual(["FY26-099"]);
    expect(ids({ status: "all" })).toHaveLength(6);
    expect(ids({ status: "all", fy: "fy26" })).toEqual(["FY26-099"]);
    expect(ids({ q: "pat" })).toEqual(["FY27-001"]);
    expect(ids({ q: "KIM@" })).toEqual(["FY27-004"]);
    expect(ids({ status: "all", q: "book fair" })).toEqual(["FY26-099"]);
    expect(ids({ status: "all", q: "FY27-00" })).toHaveLength(5);
  });

  it("ignores values it doesn't know, and keeps only the non-defaults in the export link", () => {
    expect(parseFilters({ status: "Bogus", fy: "2027", paid: "yes" })).toEqual(defaults);
    expect(parseFilters({ status: ["Paid", "Returned"] }).status).toBe("Paid");
    expect(filtersQuery(defaults)).toBe("");
    expect(filtersQuery(parseFilters({ status: "Returned", fy: "FY27", q: "art & craft", paid: "1" }))).toBe("status=Returned&fy=FY27&q=art+%26+craft&paid=1");
  });

  it("lists the oldest first, those with no age last, and the fiscal years newest first", () => {
    const sorted = oldestFirst([
      apRow({ request_id: "new", submitted_at: "2026-11-18T17:00:00.000Z" }),
      apRow({ request_id: "paid", status: "Paid", submitted_at: "2026-09-01T17:00:00.000Z" }),
      apRow({ request_id: "old", submitted_at: "2026-10-01T17:00:00.000Z" }),
    ]);
    expect(sorted.map((r) => r.request_id)).toEqual(["old", "new", "paid"]);
    expect(fiscalYears(rows)).toEqual(["FY27", "FY26"]);
  });

  it("reads earlier versions' packets as written, oldest first", () => {
    expect(earlierPackets(apRow({ previous_pdf_file_ids: "1AbC-v1, 1dEf-v2" }))).toEqual(["1AbC-v1", "1dEf-v2"]);
    expect(earlierPackets(apRow())).toEqual([]);
  });
});

describe("budget categories", () => {
  const tab: CategoryRow[] = [
    { name: "Supplies", active: "", order: "2" },
    { name: "Fun Run", active: "yes", order: "1" },
    { name: "Old line", active: "no", order: "0" },
    { name: "Hospitality", active: "", order: "" },
  ];

  it("offers nothing to save until the tab has rows (the blank is called Uncategorized), then its active ones by order", () => {
    expect(categoryChoices([], apRow())).toEqual({ options: [], selected: "", suggested: false, noneYet: true });
    expect(categoryChoices(tab, apRow())).toEqual({ options: ["Fun Run", "Supplies", "Hospitality"], selected: "", suggested: false, noneYet: false });
  });

  it("keeps a request's own category after it's made inactive", () => {
    expect(categoryChoices(tab, apRow({ budget_category: "Old line" }))).toEqual({ options: ["Fun Run", "Supplies", "Hospitality", "Old line"], selected: "Old line", suggested: false, noneYet: false });
  });

  it("starts on the FO10's Budget Account when it names a category and none is saved", () => {
    expect(categoryChoices(tab, apRow({ budget_account: "fun run" }))).toMatchObject({ selected: "Fun Run", suggested: true });
    expect(categoryChoices(tab, apRow({ budget_account: "Classroom stipend" }))).toMatchObject({ selected: "", suggested: false });
    expect(categoryChoices(tab, apRow({ budget_account: "Fun Run", budget_category: "Supplies" }))).toMatchObject({ selected: "Supplies", suggested: false });
  });

  it("saves the category and records who set it", async () => {
    const { adapters, log, actions, categoryRows } = world();
    categoryRows.push(...tab);
    log.rows.push(apRow());
    const now = new Date("2026-11-19T21:00:00.000Z");
    expect(await setCategory({ requestId: "FY27-001", category: "Supplies", by: "treasurer@example.org", now }, adapters)).toBe("saved");
    expect(log.rows[0].budget_category).toBe("Supplies");
    expect(actions.records).toEqual([{ request_id: "FY27-001", action: "category", by: "treasurer@example.org", at: now.toISOString(), note: "Supplies" }]);
    // The same again changes nothing and records nothing.
    expect(await setCategory({ requestId: "FY27-001", category: "Supplies", by: "treasurer@example.org" }, adapters)).toBe("unchanged");
    expect(actions.records).toHaveLength(1);
    // Clearing it is allowed and recorded.
    expect(await setCategory({ requestId: "FY27-001", category: "", by: "treasurer@example.org" }, adapters)).toBe("saved");
    expect(log.rows[0].budget_category).toBe("");
    expect(actions.records[1]).toMatchObject({ action: "category", note: "" });
  });

  it("refuses a category that isn't offered, and a request that isn't there", async () => {
    const { adapters, log, actions, categoryRows } = world();
    categoryRows.push(...tab);
    log.rows.push(apRow());
    await expect(setCategory({ requestId: "FY27-001", category: "Old line", by: "a@example.org" }, adapters)).rejects.toEqual(new CategoryError("unknown"));
    await expect(setCategory({ requestId: "FY27-001", category: UNCATEGORIZED, by: "a@example.org" }, adapters)).rejects.toEqual(new CategoryError("unknown"));
    await expect(setCategory({ requestId: "FY27-999", category: "Supplies", by: "a@example.org" }, adapters)).rejects.toEqual(new CategoryError("not-found"));
    expect(log.rows[0].budget_category).toBe("");
    expect(actions.records).toEqual([]);
  });

  it("never saves Uncategorized: it's only the dropdown's name for blank while the tab is empty", async () => {
    const { adapters, log } = world();
    log.rows.push(apRow());
    await expect(setCategory({ requestId: "FY27-001", category: UNCATEGORIZED, by: "a@example.org" }, adapters)).rejects.toEqual(new CategoryError("unknown"));
    expect(log.rows[0].budget_category).toBe("");
  });

  it("still saves when the Actions tab doesn't take the record", async () => {
    const { adapters, log, categoryRows } = world();
    categoryRows.push(...tab);
    log.rows.push(apRow());
    adapters.actions = { append: async () => Promise.reject(new Error("Sheets refused")), listFor: async () => [] };
    expect(await setCategory({ requestId: "FY27-001", category: "Supplies", by: "a@example.org" }, adapters)).toBe("saved");
    expect(log.rows[0].budget_category).toBe("Supplies");
  });
});

describe("the CSV export", () => {
  it("starts with a byte-order mark and the header, one line per request", () => {
    const csv = requestsCsv([apRow({ reimbursement_claimed: "45.00", version: "" as never }), apRow({ request_id: "FY27-002", version: 2 })]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(4); // header, two rows, and the final line break
    const first = Object.fromEntries(CSV_COLUMNS.map((col, i) => [col, lines[1].split(",")[i]]));
    expect(first).toMatchObject({ request_id: "FY27-001", reimbursement_claimed: "45.00", version: "1", check_date: "", approved_by: "", paid_by: "" });
  });

  it("quotes commas, quotes and line breaks, and keeps formulas as text", () => {
    expect(csvField('Paint, "big" brushes')).toBe('"Paint, ""big"" brushes"');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvField("+1")).toBe("'+1");
    expect(csvField(3)).toBe("3");
    expect(csvField(undefined)).toBe("");
  });
});

describe("a mailed check on the dashboard", () => {
  const stored = (extra: Partial<StoredRequest["request"]> = {}, version = 1): StoredRequest => ({
    requestId: "FY27-001",
    version,
    submittedAt: "2026-11-01T17:00:00.000Z",
    requesterEmail: "pat@example.org",
    request: { ...request(["r1"]), checkDelivery: "mail", address: "123 Main St Apt 4", cityStateZip: "San Francisco, CA 94127", ...extra },
    packet: { sha256: "", pageCount: 2, chairLine: { page: 0, x: 0, y: 0, width: 1, height: 1 } },
  });
  const row = (extra: Partial<RequestRow> = {}) =>
    apRow({ check_delivery: "mail", address: "123 Main St Apt 4", city_zip: "San Francisco, CA 94127", reimbursement_claimed: "10.00", ...extra });

  it("says nothing when the row agrees with what was signed, spacing and case aside", () => {
    expect(mailedDifferences(row({ address: "123 main st  apt 4" }), stored())).toEqual([]);
  });

  it("warns when the Sheet's address, amount or version isn't what was signed", () => {
    const differences = mailedDifferences(row({ address: "9 Elsewhere Ave", reimbursement_claimed: "100.00", version: 2 }), stored());
    expect(differences).toHaveLength(3);
    expect(differences[0]).toContain("9 Elsewhere Ave");
    expect(differences[0]).toContain("123 Main St Apt 4");
    expect(differences[1]).toContain("$100.00");
    expect(differences[1]).toContain("$10.00");
    expect(differences[2]).toContain("version 2");
    expect(mailedDifferences(row({ reimbursement_claimed: "ten" }), stored())[0]).toContain('"ten"');
  });
});

describe("where a paid check went, in the requester's words", () => {
  it("leaves out the day when the Sheet has none", () => {
    expect(paidLine({ how: "mailbox", checkNumber: "1043", paidDate: "" })).toBe("Your check #1043 went to your staff mailbox.");
    expect(paidLine({ how: "pickup", checkNumber: "1043", paidDate: "2026-11-21" })).toBe("Your check #1043 is ready for pickup from the PTA, as of Nov 21, 2026.");
    expect(paidLine({ how: "bill pay", checkNumber: "4821", paidDate: "" })).toBe("The PTA's bank mailed your check, confirmation 4821.");
  });
});

describe("reading a mailed check for the dashboard", () => {
  const packet = new TextEncoder().encode("the packet as signed");
  const signed = (extra: Partial<StoredRequest> = {}): StoredRequest => ({
    requestId: "FY27-001",
    version: 1,
    submittedAt: "2026-11-01T17:00:00.000Z",
    requesterEmail: "pat@example.org",
    request: { ...request(["r1"]), checkDelivery: "mail", address: "123 Main St Apt 4", cityStateZip: "San Francisco, CA 94127" },
    packet: { sha256: sha256(packet), pageCount: 2, chairLine: { page: 0, x: 0, y: 0, width: 1, height: 1 } },
    ...extra,
  });
  const json = (stored: StoredRequest) => new TextEncoder().encode(JSON.stringify(stored));
  const mailedRow = (extra: Partial<RequestRow> = {}) =>
    apRow({
      check_delivery: "mail",
      address: "123 Main St Apt 4",
      city_zip: "San Francisco, CA 94127",
      reimbursement_claimed: "10.00",
      request_file_id: "json-1",
      pdf_sha256: sha256(packet),
      signers_step: "Signed",
      ...extra,
    });
  const filesWith = (entries: Record<string, Uint8Array>) => {
    const files = new MemoryFiles();
    for (const [id, bytes] of Object.entries(entries)) files.add(id, "app", bytes);
    return files;
  };

  it("shows the address as signed when the JSON belongs to the packet the row records", async () => {
    const check = await mailedCheck(mailedRow(), filesWith({ "json-1": json(signed()) }));
    expect(check).toEqual({ kind: "signed", address: "123 Main St Apt 4, San Francisco, CA 94127", amountCents: 1000, differences: [] });
    expect(await mailedCheck(apRow({ check_delivery: "pickup" }), new MemoryFiles())).toBeNull();
  });

  it("won't vouch for a JSON from another request or another packet, whatever it says", async () => {
    const files = filesWith({
      "json-1": json(signed({ requestId: "FY27-002" })),
      "json-2": json(signed({ packet: { ...signed().packet, sha256: "something else" } })),
      "json-3": json(signed({ packet: { ...signed().packet, sha256: "" } })),
    });
    // Another request's JSON; another packet's; and a blank hash on both sides, which matches nothing.
    for (const row of [mailedRow(), mailedRow({ request_file_id: "json-2" }), mailedRow({ request_file_id: "json-3", pdf_sha256: "" })]) {
      expect(await mailedCheck(row, files)).toEqual({ kind: "problem", problem: expect.stringContaining("doesn't match the packet") });
    }
  });

  it("says when the JSON is missing or can't be read", async () => {
    expect(await mailedCheck(mailedRow({ request_file_id: "" }), new MemoryFiles())).toEqual({ kind: "problem", problem: expect.stringContaining("no saved copy") });
    expect(await mailedCheck(mailedRow(), new MemoryFiles())).toEqual({ kind: "problem", problem: expect.stringContaining("couldn't be read just now") });
    expect(await mailedCheck(mailedRow(), filesWith({ "json-1": new TextEncoder().encode("not json") }))).toMatchObject({ kind: "problem" });
  });

  it("knows a paper check mailed before bill pay, with the Sheet's address and no FO10", async () => {
    const october = apRow({ check_delivery: "mail", address: "9 Elsewhere Ave", city_zip: "San Francisco, CA 94112" });
    expect(mailedBeforeBillPay(october)).toBe(true);
    expect(await mailedCheck(october, new MemoryFiles())).toEqual({ kind: "before-bill-pay", address: "9 Elsewhere Ave, San Francisco, CA 94112" });
    // A bill pay row whose JSON cell was cleared isn't mistaken for one.
    expect(mailedBeforeBillPay(mailedRow({ request_file_id: "" }))).toBe(false);
    expect(mailedBeforeBillPay(apRow({ check_delivery: "pickup" }))).toBe(false);
  });

  it("reads the list's unpaid mailed checks a few at a time", async () => {
    let reading = 0;
    let most = 0;
    const files = filesWith({ "json-1": json(signed()) });
    const getFileBytes = files.getFileBytes.bind(files);
    files.getFileBytes = async (id: string) => {
      most = Math.max(most, ++reading);
      await new Promise((resolve) => setTimeout(resolve, 5));
      reading--;
      return getFileBytes(id);
    };
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => mailedRow({ request_id: `FY27-0${10 + i}` })),
      mailedRow({ request_id: "FY27-099", status: "Paid" }),
      apRow({ request_id: "FY27-098", check_delivery: "pickup" }),
    ];
    const checks = await mailedChecks(rows, files, 3);
    expect(most).toBe(3);
    expect(checks.size).toBe(10);
    expect(checks.has("FY27-099")).toBe(false);
    expect(checks.has("FY27-098")).toBe(false);
  });
});
