import type { UserRecord } from "@/server/adapters/types";
import { config } from "@/server/config";

/**
 * Who is offered "Mail it to me". Mailing is switched on account by account at
 * first, through the Users tab's `mailed_checks` column, and for everyone once
 * MAILED_CHECKS is "everyone". It also needs the check signers and bill pay
 * accounts set, and two check signers other than the requester, since a
 * requester can't authorize their own payment.
 */

export type MailingRefusal = "not-set-up" | "off" | "not-switched-on" | "too-few-signers";

/** The check signers who may sign `requesterEmail`'s request: every one but the requester. */
export function signersFor(requesterEmail: string): string[] {
  const requester = requesterEmail.trim().toLowerCase();
  return config.checkSigners.filter((signer) => signer !== requester);
}

/** Why mailing isn't offered to `user`, or null when it is. Read from the Users row each time, never the session. */
export function mailingRefusal(user: Pick<UserRecord, "email" | "mailed_checks"> | null): MailingRefusal | null {
  if (config.checkSigners.length === 0 || config.billPayAccounts.length === 0) return "not-set-up";
  if (config.mailedChecks === "off") return "off";
  if (!user) return "not-switched-on";
  const cell = String(user.mailed_checks ?? "").trim().toLowerCase();
  const switchedOn = cell === "yes" || (cell !== "no" && config.mailedChecks === "everyone");
  if (!switchedOn) return "not-switched-on";
  if (signersFor(user.email).length < 2) return "too-few-signers";
  return null;
}

export const mailingOffered = (user: Pick<UserRecord, "email" | "mailed_checks"> | null) => mailingRefusal(user) === null;

/** Thrown when a mailed request comes from an account mailing isn't offered to. */
export class MailingError extends Error {}

export const MAILING_REFUSED = "Mailing the check isn't available for your account right now. Choose the staff mailbox or pickup instead.";
