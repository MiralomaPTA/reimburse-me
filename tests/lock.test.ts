import { afterEach, describe, expect, it } from "vitest";
import type { RequestRow } from "@/server/adapters/types";
import { BusyError, isLocked, lockTiming, withRequestLock } from "@/server/requests/lock";
import { MemoryLog } from "./support";

const row = (extra: Partial<RequestRow> = {}) => ({ request_id: "FY27-001", status: "Awaiting chair", lock: "", notes: "", ...extra }) as RequestRow;

/** As the Sheet behaves: a conditional write checks the row as read, and the write lands a moment later, so two at once can both see it free. */
class SlowWriteLog extends MemoryLog {
  async updateIf(id: string, condition: (row: RequestRow) => boolean, patch: Partial<RequestRow>) {
    const read = this.rows.find((r) => r.request_id === id);
    const ok = Boolean(read && condition({ ...read }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (ok) await this.update(id, patch);
    return ok;
  }
}

describe("withRequestLock", () => {
  const timing = { ...lockTiming };
  afterEach(() => Object.assign(lockTiming, timing));

  it("writes the step's changes with the release, and releases on failure without them", async () => {
    lockTiming.settleMs = 0;
    const log = new MemoryLog();
    log.rows.push(row());
    expect(await withRequestLock(log, "FY27-001", async (r) => ({ patch: { status: "Submitted" }, result: r.status }))).toBe("Awaiting chair");
    expect(log.rows[0]).toMatchObject({ status: "Submitted", lock: "" });

    await expect(
      withRequestLock(log, "FY27-001", async () => {
        throw new Error("Drive is down");
      }),
    ).rejects.toThrow("Drive is down");
    expect(log.rows[0]).toMatchObject({ status: "Submitted", lock: "" });
  });

  it("refuses while another holds the lock, until it expires", async () => {
    lockTiming.settleMs = 0;
    const log = new MemoryLog();
    log.rows.push(row({ lock: `${new Date(Date.now() + 60_000).toISOString()} other` }));
    await expect(withRequestLock(log, "FY27-001", async () => ({ patch: {}, result: 1 }))).rejects.toBeInstanceOf(BusyError);
    log.rows[0].lock = `${new Date(Date.now() - 1).toISOString()} crashed`;
    await expect(withRequestLock(log, "FY27-001", async () => ({ patch: {}, result: 1 }))).resolves.toBe(1);
    expect(isLocked("not a date")).toBe(false);
  });

  it("lets only one of two claims made at the same moment go ahead, once the later write has landed", async () => {
    lockTiming.settleMs = 50;
    const log = new SlowWriteLog();
    log.rows.push(row());
    let ran = 0;
    const step = async () => {
      ran++;
      return { patch: {}, result: "done" };
    };
    const results = await Promise.allSettled([withRequestLock(log, "FY27-001", step), withRequestLock(log, "FY27-001", step)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: expect.any(BusyError) });
    expect(ran).toBe(1);
    expect(log.rows[0].lock).toBe("");
  });

  it("without the wait, both would go ahead: the wait is what closes the gap", async () => {
    lockTiming.settleMs = 0;
    const log = new SlowWriteLog();
    log.rows.push(row());
    let ran = 0;
    const step = async () => {
      ran++;
      return { patch: {}, result: "done" };
    };
    await Promise.allSettled([withRequestLock(log, "FY27-001", step), withRequestLock(log, "FY27-001", step)]);
    expect(ran).toBe(2);
  });
});
