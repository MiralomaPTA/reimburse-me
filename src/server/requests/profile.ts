import { getAdapters } from "@/server/adapters";

/** The "about you" details a requester used last time, so the form can start filled in. */
export interface Profile {
  payeeName: string;
  ptaPosition: string;
  phone: string;
  checkDelivery: "mail" | "mailbox";
  address: string;
  cityZip: string;
}

/**
 * Derived from the requester's most recent request in the log rather than a
 * separate profile store: nothing new to keep in sync, it follows the teacher
 * across devices, and it is always the details they used last.
 */
export async function lastProfile(email: string): Promise<Profile | null> {
  const { log } = await getAdapters();
  const rows = await log.listByEmail(email);
  if (rows.length === 0) return null;
  const last = rows.reduce((a, b) => (b.submitted_at > a.submitted_at ? b : a));
  return {
    payeeName: last.payee_name,
    ptaPosition: last.pta_position,
    phone: last.phone,
    checkDelivery: last.check_delivery === "mail" ? "mail" : "mailbox",
    address: last.address,
    cityZip: last.city_zip,
  };
}
