/** The AP address, or any address, as a tappable mailto link. Safe in server and client components. */
export function MailtoLink({ email, className = "underline" }: { email: string; className?: string }) {
  return (
    <a href={`mailto:${email}`} className={className}>
      {email}
    </a>
  );
}
