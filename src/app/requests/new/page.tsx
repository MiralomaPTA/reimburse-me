import { requireSession } from "@/server/auth/session";
import { NewRequestForm } from "@/components/NewRequestForm";

export default async function NewRequestPage() {
  const session = await requireSession("/requests/new");
  return <NewRequestForm email={session.email} />;
}
