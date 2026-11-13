import { describe, expect, it } from "vitest";
import type { EventRow, RequestRow } from "@/server/adapters/types";
import { chairRouting, EVENT_NAME_MAX, eventBudget, findEvent, guessEvents, mentions, parseEvents, type PtaEvent } from "@/lib/events";

const row = (name: string, extra: Partial<EventRow> = {}): EventRow => ({ name, chair_email: "", aliases: "", budget: "", active: "", note: "", ...extra });

describe("parseEvents", () => {
  it("reads chairs, aliases, budget and active, treating a blank active as active", () => {
    const events = parseEvents([
      row("  Fun   Run ", { chair_email: "Lillie@Example.org, norton@example.org; not-an-address", aliases: "fun-run, jog-a-thon", budget: "$1,000" }),
      row("Book Fair", { chair_email: "fair@example.org", active: "no", budget: "250.5" }),
      row("Science Night", { active: "TRUE" }),
      row("", { chair_email: "nobody@example.org" }),
    ]);
    expect(events).toEqual([
      { name: "Fun Run", chairs: ["lillie@example.org", "norton@example.org"], aliases: ["fun-run", "jog-a-thon"], budgetCents: 100000, active: true },
      { name: "Book Fair", chairs: ["fair@example.org"], aliases: [], budgetCents: 25050, active: false },
      { name: "Science Night", chairs: [], aliases: [], budgetCents: null, active: true },
    ]);
  });

  it("reads two rows with the same name as one event", () => {
    const [event] = parseEvents([row("Fun Run", { chair_email: "a@example.org", budget: "500" }), row("fun run", { chair_email: "b@example.org", aliases: "5k" })]);
    expect(event).toMatchObject({ name: "Fun Run", chairs: ["a@example.org", "b@example.org"], aliases: ["5k"], budgetCents: 50000 });
  });

  it("leaves out inactive rows when a row of the same name is active, so last year's chair and budget don't carry over", () => {
    const [event] = parseEvents([
      row("Fun Run", { chair_email: "old.chair@example.org", budget: "1500", active: "no" }),
      row("Fun Run", { chair_email: "new.chair@example.org", budget: "2000" }),
    ]);
    expect(event).toMatchObject({ chairs: ["new.chair@example.org"], budgetCents: 200000, active: true });
    // With every row inactive, the event keeps its chairs, so requests already waiting on them can still be signed.
    const [retired] = parseEvents([row("Fun Run", { chair_email: "a@example.org", active: "no" }), row("Fun Run", { chair_email: "b@example.org", active: "no" })]);
    expect(retired).toMatchObject({ chairs: ["a@example.org", "b@example.org"], active: false });
  });

  it("ignores a name longer than the form accepts", () => {
    expect(parseEvents([row("x".repeat(EVENT_NAME_MAX)), row("y".repeat(EVENT_NAME_MAX + 1))]).map((e) => e.name.length)).toEqual([EVENT_NAME_MAX]);
  });

  it("finds an event by name, ignoring case and spacing", () => {
    const events = parseEvents([row("Fun Run")]);
    expect(findEvent(events, "fun  run")?.name).toBe("Fun Run");
    expect(findEvent(events, "")).toBeNull();
    expect(findEvent(events, "Book Fair")).toBeNull();
  });
});

describe("guessing the event from the description", () => {
  it("matches whole words, ignoring case, spaces, hyphens and punctuation", () => {
    for (const text of ["Fun Run water station", "fun-run snacks", "FunRun cups", "Snacks for the FUN RUN!", "Café for the Fun Run"]) {
      expect(mentions(text, "Fun Run")).toBe(true);
    }
    expect(mentions("party supplies", "Art")).toBe(false);
    expect(mentions("Funny running shoes", "Fun Run")).toBe(false);
    expect(mentions("Jogathon prizes", "jog-a-thon")).toBe(true);
    expect(mentions("anything", "")).toBe(false);
  });

  it("names every event mentioned in the purpose or any line, in the tab's order", () => {
    const events = parseEvents([row("Book Fair"), row("Fun Run", { aliases: "jog-a-thon" }), row("Art")]);
    expect(guessEvents(["Water and cups", "Jog-a-thon prizes"], events)).toEqual(["Fun Run"]);
    expect(guessEvents(["Fun Run and Book Fair signs"], events)).toEqual(["Book Fair", "Fun Run"]);
    expect(guessEvents(["2nd grade party supplies"], events)).toEqual([]);
  });
});

describe("chairRouting", () => {
  const funRun: PtaEvent = { name: "Fun Run", chairs: ["lillie@example.org", "norton@example.org"], aliases: [], budgetCents: null, active: true };

  it("asks every chair of the event, unless the requester is one of them or there are none", () => {
    expect(chairRouting(null, "pat@example.org")).toEqual({ step: "", chairs: [] });
    expect(chairRouting(funRun, "pat@example.org")).toEqual({ step: "Waiting", chairs: ["lillie@example.org", "norton@example.org"] });
    expect(chairRouting(funRun, " Norton@Example.org ")).toEqual({ step: "Skipped: requester is a chair", chairs: [] });
    expect(chairRouting({ ...funRun, chairs: [] }, "pat@example.org")).toEqual({ step: "Skipped: no chair listed", chairs: [] });
  });
});

describe("eventBudget", () => {
  const rows = [
    { request_id: "FY27-001", status: "Paid", event: "Fun Run", reimbursement_claimed: "100.00" },
    { request_id: "FY27-002", status: "Awaiting chair", event: "fun run", reimbursement_claimed: "50.00" },
    { request_id: "FY27-003", status: "Returned", event: "Fun Run", reimbursement_claimed: "999.00" },
    { request_id: "FY26-090", status: "Paid", event: "Fun Run", reimbursement_claimed: "999.00" },
    { request_id: "FY27-004", status: "Submitted", event: "Book Fair", reimbursement_claimed: "999.00" },
    { request_id: "FY27-005", status: "Awaiting chair", event: "Fun Run", reimbursement_claimed: "80.00" },
  ] as RequestRow[];

  it("counts the event's other requests this fiscal year, paid or not, except returned ones", () => {
    expect(eventBudget({ name: "Fun Run", budgetCents: 50000 }, rows, { requestId: "FY27-005", claimedCents: 8000 })).toEqual({
      budgetCents: 50000,
      usedBeforeCents: 15000,
      thisCents: 8000,
      leftBeforeCents: 35000,
      leftAfterCents: 27000,
    });
  });

  it("goes negative when over, and is null without a budget", () => {
    expect(eventBudget({ name: "Fun Run", budgetCents: 20000 }, rows, { requestId: "FY27-005", claimedCents: 8000 })?.leftAfterCents).toBe(-3000);
    expect(eventBudget({ name: "Fun Run", budgetCents: null }, rows, { requestId: "FY27-005", claimedCents: 8000 })).toBeNull();
  });
});
