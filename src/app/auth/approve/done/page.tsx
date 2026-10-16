import { gradeName, parseGrades } from "@/server/requests/stipends";
import { formatMoney, parseMoney } from "@/lib/money";

export default async function ApproveDonePage(props: PageProps<"/auth/approve/done">) {
  const query = await props.searchParams;
  const email = typeof query.email === "string" ? query.email : "that address";
  const approved = query.status === "approved";
  // "yes" for a teacher of no one grade, otherwise their grades ("1, 2").
  const teacher = typeof query.teacher === "string" ? query.teacher : "";
  const grades = new Intl.ListFormat("en", { type: "conjunction" }).format(parseGrades(teacher === "yes" ? "" : teacher).map((g) => gradeName(g).toLowerCase()));
  const stipendCents = typeof query.stipend === "string" ? parseMoney(query.stipend) : null;
  const details = [
    teacher ? ` They're set up as a ${grades ? `${grades} ` : ""}teacher.` : "",
    stipendCents === null ? "" : ` Their own stipend is ${formatMoney(stipendCents)}.`,
  ].join("");
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-2 text-2xl font-semibold">{approved ? "Approved" : "Denied"}</h1>
      <p className="text-neutral-700">
        {approved
          ? `${email} can now use the portal. We emailed them a sign-in link.${details}`
          : `${email} will not be able to sign in. They were not notified. You can change this later by editing the Users tab of the request log.`}
      </p>
    </div>
  );
}
