import { SignJWT, jwtVerify, type JWTPayload } from "jose";
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

async function signLink(purpose: string, email: string, expiresIn: string, claims: Record<string, string | number> = {}): Promise<string> {
  return new SignJWT({ ...claims, purpose })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(email)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(signingKey());
}

/** The link's claims when it verifies and was made for `purpose`; null otherwise. */
async function verifiedPayload(token: string, purpose: string): Promise<(JWTPayload & { sub: string; iat: number }) | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey());
    if (payload.purpose !== purpose || typeof payload.sub !== "string" || typeof payload.iat !== "number") return null;
    return payload as JWTPayload & { sub: string; iat: number };
  } catch {
    return null;
  }
}

async function verifyLink(token: string, purpose: string): Promise<VerifiedLink | null> {
  const payload = await verifiedPayload(token, purpose);
  return payload ? { email: payload.sub, issuedAt: new Date(payload.iat * 1000) } : null;
}

/** Short-lived token embedded in the sign-in link. */
export const createMagicToken = (email: string): Promise<string> => signLink("magic", email, `${config.magicLinkMinutes}m`);
export const verifyMagicToken = (token: string): Promise<VerifiedLink | null> => verifyLink(token, "magic");

/** Emailed to the approver; authorizes approving or denying one address. */
export const createApprovalToken = (email: string): Promise<string> => signLink("approval", email, `${config.approvalLinkDays}d`);
export const verifyApprovalToken = (token: string): Promise<VerifiedLink | null> => verifyLink(token, "approval");

/** The claims of a link good for one version of one request: an event chair's or a check signer's. `issuedAt` is when its email went out. */
export interface RequestLink extends VerifiedLink {
  requestId: string;
  version: number;
}

async function verifyRequestLink(token: string, purpose: "chair" | "signer"): Promise<RequestLink | null> {
  const payload = await verifiedPayload(token, purpose);
  if (!payload || typeof payload.rid !== "string" || typeof payload.ver !== "number") return null;
  return { email: payload.sub, issuedAt: new Date(payload.iat * 1000), requestId: payload.rid, version: payload.ver };
}

export type ChairLink = RequestLink;

/** Emailed to an event chair; lets that address sign or look at one version of one request, and nothing else. */
export const createChairToken = (email: string, requestId: string, version: number): Promise<string> =>
  signLink("chair", email, `${config.chairLinkDays}d`, { rid: requestId, ver: version });
export const verifyChairToken = (token: string): Promise<ChairLink | null> => verifyRequestLink(token, "chair");

export type SignerLink = RequestLink;

/** Emailed to one check signer; lets that address look at, sign or send back one version of one request, and nothing else. */
export const createSignerToken = (email: string, requestId: string, version: number): Promise<string> =>
  signLink("signer", email, `${config.signerLinkDays}d`, { rid: requestId, ver: version });
export const verifySignerToken = (token: string): Promise<SignerLink | null> => verifyRequestLink(token, "signer");

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
