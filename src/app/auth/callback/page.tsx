import Link from "next/link";

/** A click, not a GET, completes sign-in so email link scanners can't use the link up. */
export default async function CallbackPage(props: PageProps<"/auth/callback">) {
  const query = await props.searchParams;
  const token = typeof query.token === "string" ? query.token : "";
  const next = typeof query.next === "string" ? query.next : "";
  if (!token) {
    return (
      <div className="mx-auto max-w-md">
        <h1 className="mb-2 text-2xl font-semibold">That link is incomplete</h1>
        <p className="text-neutral-700">
          Go back to the <Link href="/" className="underline">sign-in page</Link> and request a new link.
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-2 text-2xl font-semibold">Almost there</h1>
      <p className="mb-6 text-neutral-700">Click below to finish signing in.</p>
      <form action="/api/auth/callback" method="post">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="next" value={next} />
        <button type="submit" className="btn-primary w-full">
          Continue to the portal
        </button>
      </form>
    </div>
  );
}
