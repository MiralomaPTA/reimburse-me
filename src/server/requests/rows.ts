import type { RequestLog, RequestRow } from "@/server/adapters/types";

/** Small helpers the chair and check signer steps share: reading and noting on request rows, and the requester's resend errors. */

/** The row's version: 1 for a row from before versions, or a cell cleared by hand. */
export const versionOf = (row: Pick<RequestRow, "version">) => Number(row.version) || 1;

/** An address as compared: trimmed and lower-case. */
export const lowerEmail = (email: string) => String(email ?? "").trim().toLowerCase();

/** A comma-separated address cell as lower-case addresses. */
export const addressList = (cell: string) =>
  String(cell ?? "")
    .split(",")
    .map(lowerEmail)
    .filter(Boolean);

/**
 * Adds `lines` to the row's notes as they are now, not as some earlier read
 * had them, so a note AP typed in the meantime isn't lost. Written only if
 * the cell hasn't changed since it was read, tried a few times. Best effort:
 * never throws.
 */
export async function appendNotes(log: RequestLog, requestId: string, lines: string[]): Promise<void> {
  if (lines.length === 0) return;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await log.get(requestId);
      if (!row) return;
      const notes = [row.notes, ...lines].filter(Boolean).join(" | ");
      if (await log.updateIf(requestId, (r) => r.notes === row.notes, { notes })) return;
    }
    console.error(`[notes] the notes on ${requestId} kept changing; not added: ${lines.join(" | ")}`);
  } catch (error) {
    console.error(`[notes] couldn't add to the notes on ${requestId}: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Why a requester's resend didn't go: a `problem` code the route puts in the
 * page's URL, which the page words, and a message for the logs and tests.
 */
export class ResendProblemError<P extends string> extends Error {
  constructor(
    readonly problem: P,
    message: string,
  ) {
    super(message);
  }
}
