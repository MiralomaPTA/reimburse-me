import { z } from "zod";
import { getAdapters } from "@/server/adapters";
import { getSession } from "@/server/auth/session";
import { config } from "@/server/config";
import { ALLOWED_RECEIPT_TYPES } from "@/lib/request-schema";

const bodySchema = z.object({
  name: z.string().min(1).max(200),
  mimeType: z.enum(ALLOWED_RECEIPT_TYPES, { message: "Receipts must be JPG, PNG or PDF. HEIC photos are converted in the browser." }),
  size: z.number().int().positive().max(config.maxUploadBytes, "Each receipt must be under 10 MB"),
});

/** Opens a direct upload for one receipt; the browser then PUTs the bytes to `uploadUrl`. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Please sign in again" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid upload" }, { status: 400 });

  const { files } = await getAdapters();
  const safeName = parsed.data.name.replace(/[^\w.() -]+/g, "_").slice(0, 120);
  const session_ = await files.createUploadSession({
    name: safeName,
    mimeType: parsed.data.mimeType,
    size: parsed.data.size,
    uploader: session.email,
    origin: config.appUrl,
  });
  return Response.json(session_);
}
