import { z } from "zod";
import { getAdapters } from "@/server/adapters";
import { linkBase } from "@/server/auth/links";
import { ChairError, sendBackAsChair } from "@/server/requests/chair";

export const maxDuration = 60;

const sendBackSchema = z.object({
  requestId: z.string().min(1).max(40),
  token: z.string().min(1).max(4000),
  note: z.string().trim().min(1, "Say what needs to change").max(1000),
});

/** An event chair sends a request back instead of signing it, with a note for the requester. The emailed link's token is the only authorization. */
export async function POST(request: Request) {
  const parsed = sendBackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Please fix the form" }, { status: 400 });
  try {
    const result = await sendBackAsChair({ ...parsed.data, linkBase: linkBase(request) }, await getAdapters());
    return Response.json(result);
  } catch (error) {
    if (error instanceof ChairError) return Response.json({ error: error.message }, { status: 409 });
    console.error("[chair send back]", error);
    return Response.json({ error: "Something went wrong. Nothing was sent; please try again." }, { status: 500 });
  }
}
