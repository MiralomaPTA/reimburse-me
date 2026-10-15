export default async function ApproveDonePage(props: PageProps<"/auth/approve/done">) {
  const query = await props.searchParams;
  const email = typeof query.email === "string" ? query.email : "that address";
  const approved = query.status === "approved";
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-2 text-2xl font-semibold">{approved ? "Approved" : "Denied"}</h1>
      <p className="text-neutral-700">
        {approved
          ? `${email} can now use the portal. We emailed them a sign-in link.`
          : `${email} will not be able to sign in. They were not notified. You can change this later by editing the Users tab of the request log.`}
      </p>
    </div>
  );
}
