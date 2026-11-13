import { gradeLabel } from "@/lib/pta-position";
import { parseEvents } from "@/lib/events";
import { getAdapters } from "@/server/adapters";
import { requireApprovedSession } from "@/server/auth/session";
import { config } from "@/server/config";
import { currentFunding, parseGrades } from "@/server/requests/stipends";
import { lastProfile } from "@/server/requests/profile";
import { NewRequestForm, type Requester } from "@/components/NewRequestForm";

export default async function NewRequestPage() {
  const session = await requireApprovedSession("/requests/new");
  const { events } = await getAdapters();
  const [profile, funding, eventRows] = await Promise.all([lastProfile(session.email), currentFunding(session.user), events.list()]);
  const requester: Requester = { teacher: session.user.role === "teacher", grade: gradeLabel(parseGrades(session.user.grade)) };
  return (
    <NewRequestForm
      email={session.email}
      apEmail={config.apEmail}
      sendPacketsTo={config.sendPacketsTo}
      profile={profile}
      requester={requester}
      funding={funding}
      events={parseEvents(eventRows).filter((e) => e.active)}
    />
  );
}
