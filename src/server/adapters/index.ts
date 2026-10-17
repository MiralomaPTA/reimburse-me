import { config } from "@/server/config";
import type { Adapters } from "@/server/adapters/types";

let adapters: Adapters | null = null;

/** The storage, log, user directory, stipend amounts and mail backends selected by the ADAPTERS env var. */
export async function getAdapters(): Promise<Adapters> {
  if (adapters) return adapters;
  if (config.adapters === "google") {
    const [{ googleFileStore }, { googleRequestLog }, { googleUserDirectory }, { googleStipendTable }, { googleMailer }] = await Promise.all([
      import("@/server/adapters/google/files"),
      import("@/server/adapters/google/log"),
      import("@/server/adapters/google/users"),
      import("@/server/adapters/google/stipends"),
      import("@/server/adapters/google/mailer"),
    ]);
    adapters = { files: googleFileStore, log: googleRequestLog, users: googleUserDirectory, stipends: googleStipendTable, mailer: googleMailer };
  } else {
    // On Vercel the local adapter writes to the function's ephemeral disk: every
    // request would look submitted and then vanish. Refuse unless someone is
    // knowingly trying a production build on their own machine.
    if (config.isProduction && process.env.ALLOW_LOCAL_ADAPTERS_IN_PRODUCTION !== "1") {
      throw new Error("ADAPTERS=local in production would lose every request. Set ADAPTERS=google, or ALLOW_LOCAL_ADAPTERS_IN_PRODUCTION=1 to try a production build on a laptop.");
    }
    const [{ localFileStore }, { localRequestLog }, { localUserDirectory }, { localStipendTable }, { localMailer }] = await Promise.all([
      import("@/server/adapters/local/files"),
      import("@/server/adapters/local/log"),
      import("@/server/adapters/local/users"),
      import("@/server/adapters/local/stipends"),
      import("@/server/adapters/local/mailer"),
    ]);
    adapters = { files: localFileStore, log: localRequestLog, users: localUserDirectory, stipends: localStipendTable, mailer: localMailer };
  }
  return adapters;
}
