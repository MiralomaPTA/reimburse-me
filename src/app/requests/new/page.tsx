import { requireApprovedSession } from "@/server/auth/session";
import { config } from "@/server/config";
import { currentFunding } from "@/server/requests/stipends";
import { lastProfile } from "@/server/requests/profile";
import { NewRequestForm } from "@/components/NewRequestForm";

export default async function NewRequestPage() {
  const session = await requireApprovedSession("/requests/new");
  const [profile, funding] = await Promise.all([lastProfile(session.email), currentFunding(session.user)]);
  return <NewRequestForm email={session.email} apEmail={config.apEmail} profile={profile} funding={funding} />;
}
