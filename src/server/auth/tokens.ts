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

/** The claims of an emailed link. `issuedAt` lets a row's later sign-in or decision make the link stale. */
export interface VerifiedLink {
  email: string;
  issuedAt: Date;
}

async function signLink(purpose: string, email: string, expiresIn: string): Promise<string> {
  return new SignJWT({ purpose })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(email)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(signingKey());
}

async function verifyLink(token: string, purpose: string): Promise<VerifiedLink | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey());
    if (payload.purpose !== purpose || typeof payload.sub !== "string" || typeof payload.iat !== "number") return null;
    return { email: payload.sub, issuedAt: new Date(payload.iat * 1000) };
  } catch {
    return null;
  }
}

/** Short-lived token embedded in the sign-in link. */
export const createMagicToken = (email: string): Promise<string> => signLink("magic", email, `${config.magicLinkMinutes}m`);
export const verifyMagicToken = (token: string): Promise<VerifiedLink | null> => verifyLink(token, "magic");

/** Emailed to the approver; authorizes approving or denying one address. */
export const createApprovalToken = (email: string): Promise<string> => signLink("approval", email, `${config.approvalLinkDays}d`);
export const verifyApprovalToken = (token: string): Promise<VerifiedLink | null> => verifyLink(token, "approval");

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
