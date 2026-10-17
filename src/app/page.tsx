import Image from "next/image";
import { redirect } from "next/navigation";
import logo from "@/images/miraloma-logo.png";
import { approvedUser, getSession } from "@/server/auth/session";
import { config } from "@/server/config";
import { safeNextPath } from "@/lib/next-path";
import { MailtoLink } from "@/components/MailtoLink";
import { SignInForm } from "@/components/SignInForm";

const notice = "mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900";

export default async function SignInPage(props: PageProps<"/">) {
  const [session, query] = await Promise.all([getSession(), props.searchParams]);
  const next = safeNextPath(query.next) ?? undefined;
  // A cookie alone is not enough: the address must still be approved in the Users tab.
  const approved = session ? await approvedUser(session) : null;
  if (approved) redirect(next ?? "/requests");
  return (
    <div className="mx-auto max-w-md">
      <Image src={logo} alt="Miraloma Elementary" width={144} height={144} priority className="mx-auto mb-4 h-36 w-36 rounded-full bg-white" />
      <h1 className="mb-2 text-center text-2xl font-semibold">Get reimbursed by the PTA</h1>
      <p className="mb-6 text-center text-neutral-600">
        Enter your email and we&apos;ll send you a sign-in link. No password needed. Then photograph your receipts,
        fill in a few details, and sign from your phone. First time here? The PTA approves new addresses once, usually
        within a day.
      </p>
      {session && (
        <p className={notice}>
          You&apos;re signed in as <strong>{session.email}</strong>, but that address is no longer approved for the portal. Email{" "}
          <MailtoLink email={config.apEmail} /> if that&apos;s a mistake, or sign in with another address below.
        </p>
      )}
      {query.expired === "1" && <p className={notice}>That sign-in link has expired or was already used. Request a new one below.</p>}
      {query.unapproved === "1" && (
        <p className={notice}>
          That address isn&apos;t approved for the portal. If it was before, the PTA may have removed it; email <MailtoLink email={config.apEmail} />.
        </p>
      )}
      <div className="card">
        <SignInForm next={next} />
      </div>
    </div>
  );
}
