import { requireSession } from "@/server/auth/session";
import { config } from "@/server/config";
import { currentFunding } from "@/server/requests/stipends";
import { lastProfile } from "@/server/requests/profile";
import { NewRequestForm } from "@/components/NewRequestForm";

export default async function NewRequestPage() {
  const session = await requireSession("/requests/new");
  const [profile, funding] = await Promise.all([lastProfile(session.email), currentFunding(session.email)]);
  return <NewRequestForm email={session.email} apEmail={config.apEmail} profile={profile} funding={funding} />;
}
