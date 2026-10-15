import { config } from "@/server/config";
import { MailtoLink } from "@/components/MailtoLink";

export default async function PendingPage(props: PageProps<"/auth/pending">) {
  const query = await props.searchParams;
  const email = typeof query.email === "string" ? query.email : "your address";
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-2 text-2xl font-semibold">One quick approval first</h1>
      <p className="text-neutral-700">
        <strong>{email}</strong> isn&apos;t on the portal&apos;s list yet, so we&apos;ve asked the PTA to approve it. Once they
        do, you&apos;ll get an email with your sign-in link. There&apos;s nothing else to do right now.
      </p>
      <p className="mt-4 text-sm text-neutral-500">
        Already approved and just didn&apos;t get an email? Check spam, or email <MailtoLink email={config.apEmail} />.
      </p>
    </div>
  );
}
