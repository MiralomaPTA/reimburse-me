import { config } from "@/server/config";

/**
 * Base URL for links we email. In production APP_URL is authoritative: a
 * client-supplied Origin must never steer where an emailed link points. In
 * local development the dev server often lands on another port, so follow the
 * browser's origin instead.
 */
export function linkBase(request: Request): string {
  const origin = request.headers.get("origin");
  return config.adapters === "local" && origin ? origin : config.appUrl;
}
