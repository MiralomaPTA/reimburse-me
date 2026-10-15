import Image from "next/image";
import { redirect } from "next/navigation";
import logo from "@/images/miraloma-logo.png";
import { getSession } from "@/server/auth/session";
import { SignInForm } from "@/components/SignInForm";

export default async function SignInPage(props: PageProps<"/">) {
  const session = await getSession();
  const query = await props.searchParams;
  const next = typeof query.next === "string" ? query.next : undefined;
  if (session) redirect(next && next.startsWith("/") ? next : "/requests");
  return (
    <div className="mx-auto max-w-md">
      <Image src={logo} alt="Miraloma Elementary" width={144} height={144} priority className="mx-auto mb-4 h-36 w-36 rounded-full bg-white" />
      <h1 className="mb-2 text-center text-2xl font-semibold">Get reimbursed by the PTA</h1>
      <p className="mb-6 text-center text-neutral-600">
        Enter your email and we&apos;ll send you a sign-in link. No password needed. Then photograph your receipts,
        fill in a few details, and sign from your phone. First time here? The PTA approves new addresses once, usually
        within a day.
      </p>
      {query.expired === "1" && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          That sign-in link has expired or was already used. Request a new one below.
        </p>
      )}
      <div className="card">
        <SignInForm next={next} />
      </div>
    </div>
  );
}
