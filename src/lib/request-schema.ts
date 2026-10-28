import { z } from "zod";

/** Shared between the form (client) and the submit/preview handlers (server). */

/** Long enough for a vendor and a few items; the form wraps it over several lines. */
export const DESCRIPTION_MAX = 200;
export const ALLOWED_RECEIPT_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
/** The upload route and the browser both refuse larger receipts. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "10 MB";
export const FUNDING_KEYS = ["classroom", "grade", "field_trip", "stipend", "none"] as const;
export type FundingKey = (typeof FUNDING_KEYS)[number];
/** A funding choice: one of the keys, with the grade spelled out for a grade's stipend ("grade:2"). */
export const FUNDING_CHOICE = /^(classroom|field_trip|stipend|none|grade:[A-Z0-9]{1,8})$/;

export const receiptSchema = z.object({
  fileId: z.string().min(8).max(128),
  name: z.string().min(1).max(200),
  mimeType: z.enum(ALLOWED_RECEIPT_TYPES),
});

export const lineItemSchema = z.object({
  description: z.string().trim().min(1, "Describe the purchase").max(DESCRIPTION_MAX, `Keep it under ${DESCRIPTION_MAX} characters`),
  amountCents: z.number().int().positive("Enter an amount"),
  receipts: z.array(receiptSchema).min(1, "Add a receipt").max(10),
  /** Which of the requester's stipends pays for this line, e.g. "classroom" or "grade:2"; "none" when it isn't from one (or they have none). */
  funding: z.string().regex(FUNDING_CHOICE, "Choose which stipend this comes from").default("none"),
});

export const requestInputSchema = z
  .object({
    payeeName: z.string().trim().min(1, "Enter your name").max(80),
    ptaPosition: z.string().trim().min(1, "Enter your PTA position").max(80),
    phone: z.string().trim().min(7, "Enter a phone number").max(30),
    checkDelivery: z.enum(["pickup", "mailbox"]),
    purpose: z.string().trim().min(1, "Say what the expenditure was for").max(60),
    items: z.array(lineItemSchema).min(1, "Add at least one receipt").max(40),
    donationCents: z.number().int().min(0).default(0),
  })
  .superRefine((value, ctx) => {
    const total = value.items.reduce((sum, item) => sum + item.amountCents, 0);
    if (value.donationCents > total) {
      ctx.addIssue({ code: "custom", path: ["donationCents"], message: "You can't donate more than the total" });
    }
  });

export type RequestInput = z.infer<typeof requestInputSchema>;
export type LineItem = z.infer<typeof lineItemSchema>;
export type Receipt = z.infer<typeof receiptSchema>;

export const signatureSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("typed"), name: z.string().trim().min(2).max(80) }),
  z.object({ type: z.literal("drawn"), pngDataUrl: z.string().startsWith("data:image/png;base64,").max(2_000_000) }),
]);

export type SignatureInput = z.infer<typeof signatureSchema>;

export const submitSchema = z.object({
  request: requestInputSchema,
  signature: signatureSchema,
  consent: z.literal(true, { message: "Tick the box to sign electronically" }),
});

export interface Totals {
  totalCents: number;
  donationCents: number;
  reimbursementCents: number;
}

export function totals(input: Pick<RequestInput, "items" | "donationCents">): Totals {
  const totalCents = input.items.reduce((sum, item) => sum + item.amountCents, 0);
  return { totalCents, donationCents: input.donationCents, reimbursementCents: totalCents - input.donationCents };
}

/** One funding choice's share of a request. */
export interface FundingShare {
  /** The choice as the form sends it: "classroom", "grade:2", "none". */
  funding: string;
  /** The lines charged to it, before any donation. */
  expenseCents: number;
  /** What is claimed from it: its share of the reimbursement, after the donation. */
  claimedCents: number;
}

/**
 * The request's lines grouped by funding choice, in the order the choices
 * first appear. A donation to the PTA comes off every share in proportion to
 * its expense, rounded so the claimed shares add up exactly to the
 * reimbursement claimed (the odd cents go to the largest shares).
 */
export function fundingSplit(input: { items: Pick<LineItem, "amountCents" | "funding">[]; donationCents: number }): FundingShare[] {
  const shares: FundingShare[] = [];
  for (const item of input.items) {
    const share = shares.find((s) => s.funding === item.funding);
    if (share) share.expenseCents += item.amountCents;
    else shares.push({ funding: item.funding, expenseCents: item.amountCents, claimedCents: 0 });
  }
  const totalCents = shares.reduce((sum, s) => sum + s.expenseCents, 0);
  const reimbursementCents = Math.max(0, totalCents - input.donationCents);
  if (totalCents === 0) return shares;
  const exact = shares.map((s) => (s.expenseCents * reimbursementCents) / totalCents);
  let left = reimbursementCents;
  shares.forEach((s, i) => {
    s.claimedCents = Math.floor(exact[i]);
    left -= s.claimedCents;
  });
  // Largest remainder first; ties go to the earlier share.
  const order = shares.map((_, i) => i).sort((a, b) => exact[b] - Math.floor(exact[b]) - (exact[a] - Math.floor(exact[a])) || a - b);
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) shares[order[i]].claimedCents++;
  return shares;
}

/** "415", "555-1234" for the form's two phone boxes; falls back to the raw string. */
export function splitPhone(phone: string): { area: string; number: string } {
  const digits = phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (digits.length === 10) return { area: digits.slice(0, 3), number: `${digits.slice(3, 6)}-${digits.slice(6)}` };
  return { area: "", number: phone.trim() };
}

export const CHECK_DELIVERY_LABEL: Record<RequestInput["checkDelivery"], string> = {
  pickup: "Requester will arrange pickup with the PTA",
  mailbox: "Leave the check in the staff mailbox",
};
