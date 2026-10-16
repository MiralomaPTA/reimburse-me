import { googleConfig } from "@/server/config";
import { SheetTable } from "@/server/adapters/google/sheet-table";
import { USER_COLUMNS, type UserDirectory, type UserRecord } from "@/server/adapters/types";

/** The allow-list and AP list: the `Users` tab of the spreadsheet. */

let table: SheetTable<UserRecord> | null = null;

function users(): SheetTable<UserRecord> {
  if (!table) table = new SheetTable<UserRecord>(googleConfig().usersSheetName, USER_COLUMNS, "email");
  return table;
}

function normalize(row: UserRecord): UserRecord {
  // Hand-edited rows may have odd casing or spaces; treat anything unrecognized as pending.
  const role = row.role.trim().toLowerCase();
  const status = row.status.trim().toLowerCase();
  return {
    ...row,
    email: row.email.trim().toLowerCase(),
    role: role === "teacher" || role === "ap" || role === "admin" ? role : "requester",
    status: status === "approved" || status === "denied" ? status : "pending",
  };
}

export const googleUserDirectory: UserDirectory = {
  async get(email) {
    const found = await users().find(email);
    return found ? normalize(found.row) : null;
  },
  async upsert(record) {
    await users().upsert({ ...record, email: record.email.trim().toLowerCase() });
  },
  async countPendingSince(sinceIso) {
    return (await users().readAll()).map((r) => normalize(r.row)).filter((r) => r.status === "pending" && r.requested_at >= sinceIso).length;
  },
};
