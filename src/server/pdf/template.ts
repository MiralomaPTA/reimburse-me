import { promises as fs } from "node:fs";
import path from "node:path";

let cached: Uint8Array | null = null;

/** The PTA form (Revised July 2022) with its 34 fields renamed; see specs/. */
export async function templateBytes(): Promise<Uint8Array> {
  if (!cached) cached = new Uint8Array(await fs.readFile(path.join(process.cwd(), "assets", "form-template.pdf")));
  return cached;
}

/** Field names in the template. Treasurer-block and address fields are listed for completeness but never filled. */
export const FIELDS = {
  payeeName: "payee_name",
  ptaPosition: "pta_position",
  address: "address",
  cityZip: "city_zip",
  phoneArea: "phone_area_code",
  phoneNumber: "phone_number",
  email: "email",
  purpose: "purpose",
  itemDescription: (n: 1 | 2 | 3 | 4) => `item_${n}_description`,
  itemAmount: (n: 1 | 2 | 3 | 4) => `item_${n}_amount`,
  totalExpense: "total_expense",
  totalClaimed: "total_claimed",
  advanceReceived: "advance_received",
  reimbursementClaimed: "reimbursement_claimed",
  donationToPta: "donation_to_pta",
  refundToPta: "refund_to_pta",
  requesterSignature: "requester_signature",
  requesterSignatureDate: "requester_signature_date",
} as const;
