import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_COLUMNS, REQUEST_COLUMNS, STIPEND_COLUMNS, USER_COLUMNS, type EventRow, type StipendRow, type UserRecord } from "@/server/adapters/types";
import { chairRouting, parseEvents } from "@/lib/events";
import { fundingOptions, GRADES, parseAmount, parseFunding, parseGrades } from "@/server/requests/stipends";

/**
 * The sample `.data` files in examples/local-data, and the CSVs in
 * examples/google-sheet made from them, stay in step with the data model.
 */

const load = <T>(name: string): T[] => JSON.parse(readFileSync(path.join(process.cwd(), "examples/local-data", name), "utf8"));
const users = load<UserRecord>("users.json");
const stipends = load<StipendRow>("stipends.json");
const events = load<EventRow>("events.json");
const options = (email: string) => fundingOptions(users.find((u) => u.email === email)!, stipends, [], new Date()).stipends.map((s) => s.label);

describe("examples/local-data", () => {
  it("users.json has every Users column and valid values", () => {
    for (const user of users) {
      expect(Object.keys(user).sort()).toEqual([...USER_COLUMNS].sort());
      expect(["requester", "teacher", "ap", "admin"]).toContain(user.role);
      expect(user.status).toBe("approved");
      for (const grade of parseGrades(user.grade)) expect(GRADES).toContain(grade);
      if (user.stipend) expect(parseAmount(user.stipend)).not.toBeNull();
    }
  });

  it("stipends.json has a readable amount for the classroom, field trip and every grade", () => {
    for (const row of stipends) {
      expect(Object.keys(row).sort()).toEqual([...STIPEND_COLUMNS].sort());
      expect(parseAmount(row.amount)).not.toBeNull();
    }
    const names = stipends.map((row) => parseFunding(row.name));
    expect(names.map((n) => n.key)).toEqual(expect.arrayContaining(["classroom", "field_trip"]));
    expect(names.filter((n) => n.key === "grade").map((n) => n.grade)).toEqual(GRADES);
  });

  it("events.json has every Events column, and each event behaves as its note says", () => {
    for (const row of events) expect(Object.keys(row).sort()).toEqual([...EVENT_COLUMNS].sort());
    const parsed = parseEvents(events);
    const byName = (name: string) => parsed.find((e) => e.name === name)!;
    expect(parsed.filter((e) => e.active).map((e) => e.name)).toEqual(["Fun Run", "Fall Festival", "Book Fair"]);
    expect(chairRouting(byName("Fun Run"), "grade2.teacher@example.org").chairs).toHaveLength(2);
    expect(byName("Fun Run").budgetCents).toBe(150000);
    // The sample volunteer's Fall Festival request goes to its chair (the help screenshots show this); they chair the Book Fair themselves.
    expect(users.some((u) => u.email === "volunteer@example.org")).toBe(true);
    expect(chairRouting(byName("Fall Festival"), "volunteer@example.org").step).toBe("Waiting");
    expect(chairRouting(byName("Book Fair"), "volunteer@example.org").step).toBe("Skipped: requester is a chair");
    expect(byName("Book Fair").budgetCents).toBeNull();
  });

  it("shows each kind of requester the choices its note describes", () => {
    expect(options("grade2.teacher@example.org")).toEqual(["Classroom stipend", "Grade 2 stipend", "Field trip"]);
    expect(options("tk.teacher@example.org")).toEqual(["Classroom stipend", "Grade TK stipend", "Field trip"]);
    expect(options("combo.teacher@example.org")).toEqual(["Classroom stipend", "Grade 1 stipend", "Grade 2 stipend", "Field trip"]);
    expect(options("music.teacher@example.org")).toEqual(["Classroom stipend", "Field trip"]);
    expect(options("librarian@example.org")).toEqual(["Stipend"]);
    expect(options("volunteer@example.org")).toEqual([]);
    expect(options("treasurer@example.org")).toEqual([]);
    const jobShare = fundingOptions(users.find((u) => u.email === "jobshare.teacher@example.org")!, stipends, [], new Date()).stipends[0];
    expect(jobShare).toMatchObject({ key: "classroom", amountCents: 12500 });
  });
});

/** Just enough CSV for these files: quoted fields, doubled quotes, \n line ends. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      rows.push([...row, field]);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

const csv = (name: string) => {
  const [header, ...rows] = parseCsv(readFileSync(path.join(process.cwd(), "examples/google-sheet", name), "utf8"));
  return { header, rows: rows.map((values) => Object.fromEntries(header.map((col, i) => [col, values[i] ?? ""]))) };
};

describe("examples/google-sheet", () => {
  it("has each tab's headers in the app's column order", () => {
    expect(csv("Users.csv").header).toEqual(USER_COLUMNS);
    expect(csv("Stipends.csv").header).toEqual(STIPEND_COLUMNS);
    expect(csv("Events.csv").header).toEqual(EVENT_COLUMNS);
    expect(csv("Requests.csv")).toEqual({ header: REQUEST_COLUMNS, rows: [] });
  });

  it("holds the same people and amounts as the local examples, with the app-written dates left blank", () => {
    const sheetUsers = csv("Users.csv").rows;
    expect(sheetUsers.map(({ email, role, status, grade, stipend, note }) => ({ email, role, status, grade, stipend, note }))).toEqual(
      users.map(({ email, role, status, grade, stipend, note }) => ({ email, role, status, grade, stipend, note })),
    );
    for (const row of sheetUsers) expect([row.requested_at, row.approved_at, row.last_link_at, row.signed_in_at]).toEqual(["", "", "", ""]);
    expect(csv("Stipends.csv").rows).toEqual(stipends);
    expect(csv("Events.csv").rows).toEqual(events);
  });
});
