import { getAdapters } from "@/server/adapters";
import type { RequestRow } from "@/server/adapters/types";

/** The "about you" details a requester used last time, so the form can start filled in. */
export interface Profile {
  payeeName: string;
  ptaPosition: string;
  phone: string;
  checkDelivery: "pickup" | "mailbox" | "mail";
  /** From their most recent mailed request, even when the last request wasn't mailed; blank when none was. */
  address: string;
  cityStateZip: string;
}

/**
 * Derived from the requester's requests in the log rather than a separate
 * profile store: nothing new to keep in sync, it follows the teacher across
 * devices, and it is always the details they used last. `mailing` says whether
 * the account is offered mailing now; while it isn't, a last request that was
 * mailed starts the choice on pickup, as it did before mailing came back.
 */
export function profileFrom(rows: RequestRow[], mailing: boolean): Profile | null {
  if (rows.length === 0) return null;
  const newestFirst = [...rows].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  const last = newestFirst[0];
  // Rows from before pickup replaced mailing say "mail" and have an address, and they count too.
  const mailed = newestFirst.find((row) => row.check_delivery === "mail" && String(row.address ?? "").trim());
  return {
    payeeName: last.payee_name,
    ptaPosition: last.pta_position,
    phone: last.phone,
    checkDelivery: last.check_delivery === "mailbox" ? "mailbox" : last.check_delivery === "mail" && mailing ? "mail" : "pickup",
    address: mailed ? String(mailed.address).trim() : "",
    cityStateZip: mailed ? String(mailed.city_zip ?? "").trim() : "",
  };
}

export async function lastProfile(email: string, mailing: boolean): Promise<Profile | null> {
  const { log } = await getAdapters();
  return profileFrom(await log.listByEmail(email), mailing);
}
