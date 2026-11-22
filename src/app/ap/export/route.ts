import type { NextRequest } from "next/server";
import { getAdapters } from "@/server/adapters";
import { getApSession } from "@/server/ap/access";
import { requestsCsv } from "@/server/ap/csv";
import { matches, oldestFirst, parseFilters } from "@/server/ap/dashboard";
import { formatIsoDate } from "@/lib/dates";

/** The dashboard's CSV: the requests its current filters show, in its order. AP only. */
export async function GET(request: NextRequest) {
  const session = await getApSession();
  if (!session) return new Response("Not found", { status: 404 });
  const filters = parseFilters(Object.fromEntries(request.nextUrl.searchParams));
  const { log } = await getAdapters();
  const rows = oldestFirst((await log.list()).filter((row) => matches(row, filters)));
  return new Response(requestsCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reimbursements-${formatIsoDate(new Date())}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
