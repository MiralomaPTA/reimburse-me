import { SignJWT, jwtVerify } from "jose";
import { config, sessionSecret } from "@/server/config";

let key: Uint8Array | null = null;
const signingKey = () => (key ??= new TextEncoder().encode(sessionSecret()));

export type SignInMethod = "email-link";

export interface Session {
  email: string;
  method: SignInMethod;
  /** ISO timestamp of when the sign-in link was used. */
  signedInAt: string;
}

/** Short-lived token embedded in the sign-in link. */
export async function createMagicToken(email: string): Promise<string> {
  return new SignJWT({ purpose: "magic" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(email)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${config.magicLinkMinutes}m`)
    .sign(signingKey());
}

export async function verifyMagicToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey());
    if (payload.purpose !== "magic" || typeof payload.sub !== "string") return null;
    return payload.sub;
  } catch {
    return null;
  }
}

/** Long-lived session token stored in the cookie after a link is used. */
export async function createSessionToken(session: Session): Promise<string> {
  return new SignJWT({ purpose: "session", method: session.method, signedInAt: session.signedInAt })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.email)
    .setIssuedAt()
    .setExpirationTime(`${config.sessionDays}d`)
    .sign(signingKey());
}

export async function verifySessionToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey());
    if (payload.purpose !== "session" || typeof payload.sub !== "string") return null;
    return {
      email: payload.sub,
      method: (payload.method as SignInMethod) ?? "email-link",
      signedInAt: typeof payload.signedInAt === "string" ? payload.signedInAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}
