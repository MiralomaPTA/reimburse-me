/**
 * Best-effort sliding-window rate limiter for the sign-in link endpoint.
 *
 * State is in-memory, so on Vercel it is per function instance and resets on
 * cold start. That is enough to blunt casual abuse of the link emailer without
 * adding a database; a shared store would be needed for a hard guarantee.
 */

const windows = new Map<string, number[]>();

export function rateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    windows.set(key, recent);
    return true;
  }
  recent.push(now);
  windows.set(key, recent);
  if (windows.size > 5000) {
    // Drop stale keys so the map cannot grow without bound.
    for (const [k, times] of windows) if (times.every((t) => now - t >= windowMs)) windows.delete(k);
  }
  return false;
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
