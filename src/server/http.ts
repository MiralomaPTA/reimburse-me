/** Wraps PDF bytes in a Response. `slice()` yields an ArrayBuffer-backed view the Blob types accept. */
export function pdfResponse(bytes: Uint8Array, filename: string, cacheControl = "no-store"): Response {
  return new Response(new Blob([bytes.slice()], { type: "application/pdf" }), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": cacheControl,
    },
  });
}
