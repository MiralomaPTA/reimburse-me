import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/server/auth/session";
import { seeOther } from "@/server/http";

export async function POST() {
  (await cookies()).delete(SESSION_COOKIE);
  return seeOther("/");
}
