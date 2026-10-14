import { config } from "@/server/config";
import type { Adapters } from "@/server/adapters/types";

let adapters: Adapters | null = null;

/** The storage, log and mail backends selected by the ADAPTERS env var. */
export async function getAdapters(): Promise<Adapters> {
  if (adapters) return adapters;
  if (config.adapters === "google") {
    const [{ googleFileStore }, { googleRequestLog }, { googleMailer }] = await Promise.all([
      import("@/server/adapters/google/files"),
      import("@/server/adapters/google/log"),
      import("@/server/adapters/google/mailer"),
    ]);
    adapters = { files: googleFileStore, log: googleRequestLog, mailer: googleMailer };
  } else {
    const [{ localFileStore }, { localRequestLog }, { localMailer }] = await Promise.all([
      import("@/server/adapters/local/files"),
      import("@/server/adapters/local/log"),
      import("@/server/adapters/local/mailer"),
    ]);
    adapters = { files: localFileStore, log: localRequestLog, mailer: localMailer };
  }
  return adapters;
}
