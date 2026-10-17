import { gradeName, parseGrades } from "@/server/requests/stipends";
import { formatMoney, parseMoney } from "@/lib/money";

const OUTCOMES = ["approved", "updated", "unchanged", "denied", "already-decided"] as const;
type Outcome = (typeof OUTCOMES)[number];

const TITLES: Record<Outcome, string> = {
  approved: "Approved",
  updated: "Updated",
  unchanged: "Already approved",
  denied: "Denied",
  "already-decided": "Already decided",
};

export default async function ApproveDonePage(props: PageProps<"/auth/approve/done">) {
  const query = await props.searchParams;
  const email = typeof query.email === "string" ? query.email : "that address";
  const outcome: Outcome = OUTCOMES.find((o) => o === query.outcome) ?? "already-decided";
  // "yes" for a teacher of no one grade, otherwise their grades ("1, 2").
  const teacher = typeof query.teacher === "string" ? query.teacher : "";
  const grades = new Intl.ListFormat("en", { type: "conjunction" }).format(parseGrades(teacher === "yes" ? "" : teacher).map((g) => gradeName(g).toLowerCase()));
  const stipendCents = typeof query.stipend === "string" ? parseMoney(query.stipend) : null;
  const details = [
    teacher ? ` They're set up as a ${grades ? `${grades} ` : ""}teacher.` : "",
    stipendCents === null ? "" : ` Their own stipend is ${formatMoney(stipendCents)}.`,
  ].join("");
  const editLater = "You can change this later by editing the Users tab of the request log.";
  const messages: Record<Outcome, string> = {
    approved: `${email} can now use the portal. We emailed them a sign-in link.${details}`,
    updated: `${email} was already approved, so no email was sent. Their settings were updated.${details}`,
    unchanged: `${email} was already approved and nothing changed, so no email was sent.${details}`,
    denied: `${email} will not be able to sign in. They were not notified. ${editLater}`,
    "already-decided": `A decision about ${email} was already made with this link, so nothing changed. To change their role, grades or stipend, or to reverse the decision, edit the Users tab of the request log.`,
  };
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-2 text-2xl font-semibold">{TITLES[outcome]}</h1>
      <p className="text-neutral-700">{messages[outcome]}</p>
    </div>
  );
}
