/**
 * Mailed checks: the rules for the mailing address and the FO10's Budget
 * Account, shared by the form (client) and the server.
 *
 * The address is one line of plain characters each, and longer text is
 * refused rather than shrunk, so the FO10 prints exactly what the emails say
 * and no two characters that look alike can differ between them.
 */

/** Each address line's limit, which is also what fits the FO10's boxes at a readable size. */
export const ADDRESS_MAX = 40;
export const BUDGET_ACCOUNT_MAX = 60;

const ADDRESS_CHARS = /^[A-Za-z0-9 .,#\-/']*$/;
/** The Budget Account also takes ; & ( ), since a request split between stipends lists each: "Classroom stipend; Grade 2 stipend". */
const BUDGET_CHARS = /^[A-Za-z0-9 .,#\-/';&()]*$/;
const ZIP_AT_END = /(^|[^0-9])\d{5}(-\d{4})?$/;

/** Runs of spaces become one, and the ends are trimmed; nothing else changes. */
export const oneLine = (text: string) => String(text ?? "").replace(/\s+/g, " ").trim();

export interface MailingAddress {
  /** "123 Main St Apt 4" */
  address: string;
  /** "San Francisco, CA 94127" */
  cityStateZip: string;
}

/** What's wrong with each address line, in the requester's terms; empty when both are fine. */
export function addressProblems({ address, cityStateZip }: MailingAddress): { address?: string; cityStateZip?: string } {
  const problems: { address?: string; cityStateZip?: string } = {};
  const street = oneLine(address);
  const city = oneLine(cityStateZip);
  if (!street) problems.address = "Enter the street address the check should go to.";
  else if (street.length > ADDRESS_MAX) problems.address = `Keep the street address to ${ADDRESS_MAX} characters. Abbreviate, like "St" for "Street".`;
  else if (!ADDRESS_CHARS.test(street)) problems.address = "Use only letters, numbers, spaces and . , # - / ' in the street address.";
  if (!city) problems.cityStateZip = "Enter the city, state and ZIP code.";
  else if (city.length > ADDRESS_MAX) problems.cityStateZip = `Keep the city, state and ZIP to ${ADDRESS_MAX} characters.`;
  else if (!ADDRESS_CHARS.test(city)) problems.cityStateZip = "Use only letters, numbers, spaces and . , # - / ' in the city, state and ZIP.";
  else if (!ZIP_AT_END.test(city)) problems.cityStateZip = "End with the 5-digit ZIP code, like San Francisco, CA 94127.";
  return problems;
}

/** "123 Main St Apt 4, San Francisco, CA 94127" */
export const formatAddress = ({ address, cityStateZip }: MailingAddress) => `${oneLine(address)}, ${oneLine(cityStateZip)}`;

/** For deciding whether an address changed: case, spacing and punctuation don't count. */
export const sameAddress = (a: MailingAddress, b: MailingAddress) => squash(formatAddress(a)) === squash(formatAddress(b));

/** Lower-case letters and digits only: "Harvey Milk" and "harvey  milk." match. */
export const squash = (text: string) =>
  String(text ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** What's wrong with a Budget Account the first check signer typed, or null. */
export function budgetAccountProblem(value: string): string | null {
  const text = oneLine(value);
  if (!text) return "Enter the Budget Account the payment comes from.";
  if (text.length > BUDGET_ACCOUNT_MAX) return `Keep the Budget Account to ${BUDGET_ACCOUNT_MAX} characters.`;
  if (!BUDGET_CHARS.test(text)) return "Use only letters, numbers, spaces and . , # - / ' ; & ( ) in the Budget Account.";
  return null;
}
