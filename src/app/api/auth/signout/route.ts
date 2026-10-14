import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/server/auth/session";
import { config } from "@/server/config";

export async function POST() {
  (await cookies()).delete(SESSION_COOKIE);
  return Response.redirect(new URL("/", config.appUrl), 303);
}
