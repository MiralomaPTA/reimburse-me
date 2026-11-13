import { randomUUID } from "node:crypto";
import type { RequestLog, RequestRow } from "@/server/adapters/types";

/**
 * A short-lived lock on one request's row, for the steps that mustn't run
 * twice at once: a chair signing (two co-chairs at the same moment would send
 * AP two co-signed packets) and the requester's resend (a double click would
 * email every chair twice).
 *
 * The Sheet has no compare-and-set, so the lock is claimed in three steps:
 * write it only if no live lock is there (`updateIf`), wait `settleMs`, then
 * read it back. Two claims that both saw the row free both write, one after
 * the other; the wait lets the later write land before either reads back, so
 * only the later one finds its own lock and goes ahead. That holds as long as
 * a write lands within `settleMs` of the read before it, which a Sheets write
 * does in well under a second.
 *
 * The step's own changes are written together with the lock's release. A
 * lock left by a crash (a function killed at its time limit) expires after
 * `holdMs`.
 */

export const lockTiming = {
  /** Long enough for a competing write to land. Tests set it to 0. */
  settleMs: 1500,
  /** Longer than any step takes; the routes allow 60 seconds. */
  holdMs: 3 * 60_000,
};

/** Another step holds the lock right now. */
export class BusyError extends Error {
  constructor() {
    super("Someone else is working on this request right now.");
  }
}

/** Whether `lock` is a live lock (unexpired) at `now`. */
export function isLocked(lock: string, now = new Date()): boolean {
  const expires = new Date(String(lock ?? "").split(" ")[0]);
  return !Number.isNaN(expires.getTime()) && expires > now;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `step` holding the lock on `requestId`'s row, with the row as read
 * after the lock was claimed. `step` returns the changes to make to the row
 * (written with the release, in one update) and its result. Throws BusyError
 * when the lock is held, or lost to a claim at the same moment. If `step`
 * throws, the lock is released and the row left as it was.
 */
export async function withRequestLock<T>(
  log: RequestLog,
  requestId: string,
  step: (row: RequestRow) => Promise<{ patch: Partial<RequestRow>; result: T }>,
): Promise<T> {
  const value = `${new Date(Date.now() + lockTiming.holdMs).toISOString()} ${randomUUID()}`;
  if (!(await log.updateIf(requestId, (row) => !isLocked(row.lock), { lock: value }))) throw new BusyError();
  if (lockTiming.settleMs > 0) await sleep(lockTiming.settleMs);
  const row = await log.get(requestId);
  if (!row || row.lock !== value) throw new BusyError();

  const ours = (r: RequestRow) => r.lock === value;
  let outcome: { patch: Partial<RequestRow>; result: T };
  try {
    outcome = await step(row);
  } catch (error) {
    await log.updateIf(requestId, ours, { lock: "" }).catch(() => undefined);
    throw error;
  }
  // Only fails if the lock expired mid-step and another step took it.
  if (!(await log.updateIf(requestId, ours, { ...outcome.patch, lock: "" }))) throw new BusyError();
  return outcome.result;
}
