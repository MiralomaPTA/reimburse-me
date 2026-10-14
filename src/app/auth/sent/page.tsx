export default async function SentPage(props: PageProps<"/auth/sent">) {
  const query = await props.searchParams;
  const email = typeof query.email === "string" ? query.email : "your address";
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-2 text-2xl font-semibold">Check your email</h1>
      <p className="text-neutral-700">
        We sent a sign-in link to <strong>{email}</strong>. Open it on this device to continue. The link works for 15
        minutes.
      </p>
      <p className="mt-4 text-sm text-neutral-500">Not there? Check spam, or go back and try again.</p>
    </div>
  );
}
