import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RequestRow } from "@/server/adapters/types";
import { config } from "@/server/config";
import { ApActionError, approveRequest, availableActions, markSent, recordPayment, returnRequest } from "@/server/ap/actions";
import { sha256 } from "@/server/hash";
import { lockTiming } from "@/server/requests/lock";
import { resubmitRequest } from "@/server/requests/resubmit";
import type { StoredRequest } from "@/server/requests/stored";
import { submitRequest } from "@/server/requests/submit";
import { formatIsoDate } from "@/lib/dates";
import { apRow, jpeg, ME, request, session, teacher, world } from "./support";

const AP = "treasurer@example.org";
const COSIGNER = "president@example.org";
/** Nov 21, 2026, noon in San Francisco. */
const NOW = new Date("2026-11-21T20:00:00.000Z");
const LINK_BASE = "https://portal.example";

const settleMs = lockTiming.settleMs;
const savedConfig = { ...config };
beforeEach(() => {
  // The in-memory log writes at once, so there is nothing to wait for.
  lockTiming.settleMs = 0;
});
afterEach(() => {
  lockTiming.settleMs = settleMs;
  Object.assign(config, savedConfig);
});

/** One request from Pat, with AP's category set: a check for the staff mailbox unless `extra` says otherwise. */
function setup(extra: Partial<RequestRow> = {}) {
  const w = world();
  w.log.rows.push(apRow({ requester_email: ME, payee_name: "Pat Teacher", reimbursement_claimed: "45.00", check_delivery: "mailbox", budget_category: "Supplies", request_file_id: "json-0", ...extra }));
  const row = () => w.log.rows[0];
  const by = { requestId: "FY27-001", by: AP, now: NOW };
  return { ...w, row, by };
}

const refused = (problem: string) => expect.objectContaining({ problem }) as unknown as ApActionError;

describe("what AP can do", () => {
  it("depends on the status, and is nothing on your own request", () => {
    const actionsAt = (status: RequestRow["status"], requester = ME) => availableActions(apRow({ status, requester_email: requester }), AP);
    expect(actionsAt("Submitted")).toEqual(["approve", "return", "record"]);
    expect(actionsAt("Approved")).toEqual(["return", "record"]);
    expect(actionsAt("Check written")).toEqual(["return", "sent"]);
    for (const status of ["Awaiting chair", "Awaiting signers", "Returned", "Paid"] as const) expect(actionsAt(status)).toEqual([]);
    expect(actionsAt("Submitted", " Treasurer@Example.org ")).toEqual([]);
  });
});

describe("Approve", () => {
  it("approves, records who did it, and emails nobody", async () => {
    const { row, by, adapters, actions, mailer } = setup();
    const result = await approveRequest(by, adapters);
    expect(result.emailed).toBeNull();
    expect(row()).toMatchObject({ status: "Approved", approved_at: NOW.toISOString(), approved_by: AP, lock: "" });
    expect(actions.records).toEqual([{ request_id: "FY27-001", action: "approve", by: AP, at: NOW.toISOString(), note: "" }]);
    expect(mailer.sent).toEqual([]);
  });

  it("refuses your own request, a status it can't start from, and a request that isn't there", async () => {
    const own = setup({ requester_email: AP });
    await expect(approveRequest(own.by, own.adapters)).rejects.toEqual(refused("own"));
    const approved = setup({ status: "Approved" });
    await expect(approveRequest(approved.by, approved.adapters)).rejects.toEqual(refused("status"));
    const empty = setup();
    await expect(approveRequest({ ...empty.by, requestId: "FY27-999" }, empty.adapters)).rejects.toEqual(refused("not-found"));
    expect(empty.actions.records).toEqual([]);
  });

  it("checks the status again once it holds the lock, in case someone acted since", async () => {
    const { row, by, adapters, log, actions } = setup({ status: "Approved" });
    // The first read still sees it Submitted, as a page loaded a moment ago would.
    const get = log.get.bind(log);
    let reads = 0;
    log.get = async (id: string) => {
      const found = await get(id);
      return found && reads++ === 0 ? { ...found, status: "Submitted" } : found;
    };
    await expect(approveRequest(by, adapters)).rejects.toEqual(refused("status"));
    expect(row()).toMatchObject({ status: "Approved", lock: "" });
    expect(actions.records).toEqual([]);
  });

  it("goes through once when posted twice at the same moment", async () => {
    const { by, adapters, row, actions } = setup();
    const results = await Promise.allSettled([approveRequest(by, adapters), approveRequest(by, adapters)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const refusal = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(["busy", "status"]).toContain((refusal.reason as ApActionError).problem);
    expect(row()).toMatchObject({ status: "Approved", lock: "" });
    expect(actions.records).toHaveLength(1);
  });

  it("says busy while someone else holds the request", async () => {
    const { by, adapters } = setup({ lock: `${new Date(Date.now() + 60_000).toISOString()} someone` });
    await expect(approveRequest(by, adapters)).rejects.toEqual(refused("busy"));
  });
});

describe("Return with a note", () => {
  const note = "The receipt for the paint is missing.";

  it("needs a note", async () => {
    const { by, adapters, row } = setup();
    await expect(returnRequest({ ...by, note: "  ", linkBase: LINK_BASE }, adapters)).rejects.toEqual(refused("note"));
    await expect(returnRequest({ ...by, note: "x".repeat(1001), linkBase: LINK_BASE }, adapters)).rejects.toEqual(refused("note"));
    expect(row().status).toBe("Submitted");
  });

  it("returns it and emails the requester the note and a link to fix it, with AP copied", async () => {
    const { by, adapters, row, actions, mailer } = setup();
    expect(await returnRequest({ ...by, note: `  ${note}\n`, linkBase: LINK_BASE }, adapters)).toMatchObject({ emailed: true });
    expect(row()).toMatchObject({ status: "Returned", returned_note: note, returned_by: AP, returned_at: NOW.toISOString(), lock: "" });
    expect(actions.records.map((r) => [r.action, r.note])).toEqual([["return", note]]);
    expect(mailer.sent).toHaveLength(1);
    const [mail] = mailer.sent;
    expect(mail).toMatchObject({ to: [ME], cc: [config.apEmail], replyTo: config.apEmail });
    expect(mail.subject).toBe("Sent back: your PTA reimbursement request FY27-001 ($45.00)");
    expect(mail.text).toContain(note);
    expect(mail.text).toContain(`${LINK_BASE}/requests/FY27-001/fix`);
    expect(mail.text).toContain("comes straight back to the PTA");
    expect(mail.text).toContain("the PTA's accounts payable team sent your request FY27-001 back");
    expect(mail.text).not.toContain(AP);
    expect(mail.text).not.toContain("voided");
  });

  it("asks for a new request when this one is too old to fix and sign again", async () => {
    const { by, adapters, mailer } = setup({ request_file_id: "" });
    await returnRequest({ ...by, note, linkBase: LINK_BASE }, adapters);
    expect(mailer.sent[0].text).toContain("start a new request with the change");
    expect(mailer.sent[0].text).toContain(`${LINK_BASE}/requests/new`);
    expect(mailer.sent[0].text).not.toContain("/fix");
  });

  it("voids a check already written: the number leaves the row and stays in the history", async () => {
    const { by, adapters, row, actions, mailer } = setup({ status: "Check written", check_number: "1043", check_date: "2026-11-20", check_written_by: AP });
    await returnRequest({ ...by, by: COSIGNER, note, linkBase: LINK_BASE }, adapters);
    expect(row()).toMatchObject({ status: "Returned", check_number: "", check_date: "", check_written_by: "" });
    expect(actions.records.map((r) => [r.action, r.note])).toEqual([
      ["void", "check #1043, dated Nov 20, 2026"],
      ["return", note],
    ]);
    expect(mailer.sent[0].text).toContain("voided and won't be sent");
  });

  it("keeps a voided check's number in the row's notes when the Actions tab doesn't take it", async () => {
    const { by, adapters, row } = setup({ status: "Check written", check_number: "1043", check_date: "2026-11-20" });
    adapters.actions = { append: async () => Promise.reject(new Error("Sheets refused")), listFor: async () => [] };
    await returnRequest({ ...by, note, linkBase: LINK_BASE }, adapters);
    expect(row()).toMatchObject({ status: "Returned", check_number: "" });
    expect(row().notes).toContain(`Voided check #1043, dated Nov 20, 2026 (by ${AP})`);
  });

  it("returns a bill pay payment only once AP says it's cancelled at the bank", async () => {
    const billPay = { status: "Check written", check_number: "4821", check_date: "2026-11-20", check_delivery: "mail", signers_step: "Signed" } as const;
    const { by, adapters, row, actions, mailer } = setup(billPay);
    await expect(returnRequest({ ...by, note, linkBase: LINK_BASE }, adapters)).rejects.toEqual(refused("cancel"));
    expect(row().status).toBe("Check written");
    await returnRequest({ ...by, note, linkBase: LINK_BASE, cancelledAtBank: true }, adapters);
    expect(actions.records[0]).toMatchObject({ action: "void", note: "bill pay confirmation 4821, set up Nov 20, 2026, cancelled at the bank" });
    expect(mailer.sent[0].text).toContain("The payment the PTA set up with its bank has been cancelled.");
  });

  it("tells the requester who signs the new version: the chair who signed this one, and the check signers for bill pay", async () => {
    const { by, adapters, mailer } = setup({ event: "Fun Run", chair_step: "Signed", check_delivery: "mail", request_file_id: "json-1", signers_step: "Signed" });
    await returnRequest({ ...by, note, linkBase: LINK_BASE }, adapters);
    expect(mailer.sent[0].text).toContain("goes to the Fun Run chair and then two of the PTA's check signers to sign again");
  });

  it("is still returned when the email fails, and the row says so", async () => {
    const { by, adapters, row, mailer } = setup();
    mailer.failing = true;
    expect(await returnRequest({ ...by, note, linkBase: LINK_BASE }, adapters)).toMatchObject({ emailed: false });
    expect(row().status).toBe("Returned");
    expect(row().notes).toContain("Email that AP sent it back failed: Gmail refused");
  });
});

describe("Record check and Mark sent", () => {
  const check = { checkNumber: " 1043 ", checkDate: "2026-11-20", sent: false };

  it("needs the category, a number, and a real day that isn't in the future", async () => {
    const { by, adapters, row, actions } = setup({ budget_category: "" });
    await expect(recordPayment({ ...by, ...check }, adapters)).rejects.toEqual(refused("category"));
    row().budget_category = "Supplies";
    await expect(recordPayment({ ...by, ...check, checkNumber: "  " }, adapters)).rejects.toEqual(refused("check-number"));
    await expect(recordPayment({ ...by, ...check, checkDate: "2026-11-31" }, adapters)).rejects.toEqual(refused("date"));
    await expect(recordPayment({ ...by, ...check, checkDate: "11/20/2026" }, adapters)).rejects.toEqual(refused("date"));
    // A mistyped year: before the request was signed (Nov 1, 2026).
    await expect(recordPayment({ ...by, ...check, checkDate: "2025-11-20" }, adapters)).rejects.toEqual(refused("before-signed"));
    await expect(recordPayment({ ...by, ...check, checkDate: "2026-11-22" }, adapters)).rejects.toEqual(refused("future"));
    // At 7 PM in San Francisco it's already Nov 22 in UTC, but still Nov 21 here.
    const evening = new Date("2026-11-22T03:00:00.000Z");
    await expect(recordPayment({ ...by, now: evening, ...check, checkDate: "2026-11-22" }, adapters)).rejects.toEqual(refused("future"));
    expect(row().status).toBe("Submitted");
    expect(actions.records).toEqual([]);
  });

  it("records the check, then whoever sends it marks it sent, and the requester is told where it went", async () => {
    const { by, adapters, row, actions, mailer } = setup({ status: "Approved" });
    expect(await recordPayment({ ...by, ...check }, adapters)).toMatchObject({ emailed: null });
    expect(row()).toMatchObject({ status: "Check written", check_number: "1043", check_date: "2026-11-20", check_written_by: AP, paid_date: "" });
    expect(mailer.sent).toEqual([]);

    await expect(markSent({ ...by, by: COSIGNER, paidDate: "2026-11-19" }, adapters)).rejects.toEqual(refused("before-check"));
    expect(await markSent({ ...by, by: COSIGNER, paidDate: "2026-11-21" }, adapters)).toMatchObject({ emailed: true });
    expect(row()).toMatchObject({ status: "Paid", paid_date: "2026-11-21", paid_by: COSIGNER });
    expect(actions.records.map((r) => [r.action, r.by, r.note])).toEqual([
      ["check", AP, "check #1043, dated Nov 20, 2026"],
      ["sent", COSIGNER, "on Nov 21, 2026"],
    ]);
    const [mail] = mailer.sent;
    expect(mail).toMatchObject({ to: [ME], replyTo: config.apEmail });
    expect(mail.cc).toBeUndefined();
    expect(mail.subject).toBe("Paid: your PTA reimbursement request FY27-001 ($45.00)");
    expect(mail.text).toContain("Your check #1043 for $45.00 went to your staff mailbox on Nov 21, 2026.");
  });

  it("does both at once when the check is already signed and sent, as of today", async () => {
    const { by, adapters, row, actions, mailer } = setup({ check_delivery: "pickup" });
    await recordPayment({ ...by, ...check, sent: true }, adapters);
    // Dated Nov 20, it went out today, Nov 21.
    expect(row()).toMatchObject({ status: "Paid", check_number: "1043", check_date: "2026-11-20", paid_date: "2026-11-21", paid_by: AP });
    expect(actions.records.map((r) => [r.action, r.note])).toEqual([
      ["check", "check #1043, dated Nov 20, 2026"],
      ["sent", "on Nov 21, 2026"],
    ]);
    expect(mailer.sent[0].text).toContain("Your check #1043 for $45.00 is ready for pickup from the PTA, as of Nov 21, 2026. Reply to this email to arrange when to collect it.");
  });

  describe("for a check mailed by bill pay", () => {
    const packet = new TextEncoder().encode("the authorized packet");
    const stored = (extra: Partial<StoredRequest> = {}): StoredRequest => ({
      requestId: "FY27-001",
      version: 1,
      submittedAt: "2026-11-01T17:00:00.000Z",
      requesterEmail: ME,
      request: { ...request(["r1"]), checkDelivery: "mail", address: "123 Main St Apt 4", cityStateZip: "San Francisco, CA 94127" },
      packet: { sha256: sha256(packet), pageCount: 2, chairLine: { page: 0, x: 0, y: 0, width: 1, height: 1 } },
      ...extra,
    });
    const mailed = (json: StoredRequest) => {
      const w = setup({ check_delivery: "mail", address: "9 Elsewhere Ave", city_zip: "San Francisco, CA 94112", request_file_id: "json-1", pdf_sha256: sha256(packet), signers_step: "Signed" });
      w.files.add("json-1", "app", new TextEncoder().encode(JSON.stringify(json)));
      return w;
    };

    it("records the bank's confirmation, and the Paid email gives the address and amount as signed, never the Sheet's", async () => {
      const { by, adapters, actions, mailer } = mailed(stored());
      await recordPayment({ ...by, checkNumber: "4821", checkDate: "2026-11-20", sent: true }, adapters);
      expect(actions.records[0].note).toBe("bill pay confirmation 4821, set up Nov 20, 2026");
      expect(mailer.sent[0].subject).toBe("Paid: your PTA reimbursement request FY27-001 ($10.00)");
      expect(mailer.sent[0].text).toContain("The PTA's bank mailed your check for $10.00 to 123 Main St Apt 4, San Francisco, CA 94127 on Nov 21, 2026, confirmation 4821.");
      expect(mailer.sent[0].text).not.toContain("Elsewhere");
    });

    it("leaves the address and amount out when the saved request doesn't match the signed packet, rather than give the Sheet's", async () => {
      const { by, adapters, mailer } = mailed(stored({ requestId: "FY27-002" }));
      await recordPayment({ ...by, checkNumber: "4821", checkDate: "2026-11-20", sent: true }, adapters);
      expect(mailer.sent[0].subject).toBe("Paid: your PTA reimbursement request FY27-001");
      expect(mailer.sent[0].text).toContain("The PTA's bank mailed your check on Nov 21, 2026, confirmation 4821.");
      expect(mailer.sent[0].text).not.toContain("$45.00");
    });
  });

  it("is still Paid when the email fails, and the row says so", async () => {
    const { by, adapters, row, mailer } = setup({ status: "Check written", check_number: "1043", check_date: "2026-11-20" });
    mailer.failing = true;
    expect(await markSent({ ...by, paidDate: "2026-11-21" }, adapters)).toMatchObject({ emailed: false });
    expect(row().status).toBe("Paid");
    expect(row().notes).toContain("Email that it was paid failed: Gmail refused");
  });
});

describe("a new version starts AP's steps over", () => {
  it("clears the approval and the voided check when the requester signs again", async () => {
    config.sendPacketsTo = "ap";
    const w = world();
    w.files.add("r1", ME, await jpeg());
    const signed = { signature: { type: "typed" as const, name: "Pat Teacher" }, session: session(teacher), ip: "127.0.0.1", userAgent: "vitest", linkBase: LINK_BASE };
    const { requestId } = await submitRequest({ ...signed, request: request(["r1"]) }, w.adapters);
    // Submitted just now, so AP acts just now too: a check can't be dated before the request was signed.
    const by = { requestId, by: AP };
    await w.log.update(requestId, { budget_category: "Supplies" });
    await approveRequest(by, w.adapters);
    await recordPayment({ ...by, checkNumber: "1043", checkDate: formatIsoDate(new Date()), sent: false }, w.adapters);
    await returnRequest({ ...by, note: "Wrong amount on line 1.", linkBase: LINK_BASE }, w.adapters);

    await resubmitRequest({ ...signed, requestId, version: 1, request: { ...request(["r1"]), purpose: "Art supplies, corrected" } }, w.adapters);
    expect(w.log.rows[0]).toMatchObject({
      status: "Submitted",
      version: 2,
      approved_at: "",
      approved_by: "",
      check_number: "",
      check_date: "",
      check_written_by: "",
      paid_date: "",
      paid_by: "",
      // The category isn't the version's: AP set it, and it stays.
      budget_category: "Supplies",
      returned_note: "Wrong amount on line 1.",
    });
    expect(w.actions.records.map((r) => r.action)).toEqual(["approve", "check", "void", "return"]);
  }, 30_000);
});
