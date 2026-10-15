import { requireSession } from "@/server/auth/session";
import { config } from "@/server/config";
import { lastProfile } from "@/server/requests/profile";
import { NewRequestForm } from "@/components/NewRequestForm";

export default async function NewRequestPage() {
  const session = await requireSession("/requests/new");
  const profile = await lastProfile(session.email);
  return <NewRequestForm email={session.email} apEmail={config.apEmail} profile={profile} />;
}
