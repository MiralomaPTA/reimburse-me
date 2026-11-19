import type { UserRecord } from "@/server/adapters/types";

/** Who sees the AP dashboard: `role` = ap or admin in the Users tab, read on every page load. */
export const isAp = (user: Pick<UserRecord, "role">) => {
  const role = String(user.role ?? "").trim().toLowerCase();
  return role === "ap" || role === "admin";
};
