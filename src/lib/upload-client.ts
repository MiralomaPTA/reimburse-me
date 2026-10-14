"use client";

/** Browser-side receipt upload: HEIC conversion, then a direct PUT to the storage URL. */

export interface UploadedReceipt {
  fileId: string;
  name: string;
  mimeType: "image/jpeg" | "image/png" | "application/pdf";
  size: number;
}

function isHeic(file: File): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

async function toUploadable(file: File): Promise<{ blob: Blob; name: string; mimeType: UploadedReceipt["mimeType"] }> {
  if (isHeic(file)) {
    const heic2any = (await import("heic2any")).default;
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    return { blob, name: file.name.replace(/\.(heic|heif)$/i, "") + ".jpg", mimeType: "image/jpeg" };
  }
  if (file.type === "image/jpeg" || file.type === "image/png" || file.type === "application/pdf") {
    return { blob: file, name: file.name, mimeType: file.type };
  }
  if (/\.jpe?g$/i.test(file.name)) return { blob: file, name: file.name, mimeType: "image/jpeg" };
  if (/\.png$/i.test(file.name)) return { blob: file, name: file.name, mimeType: "image/png" };
  if (/\.pdf$/i.test(file.name)) return { blob: file, name: file.name, mimeType: "application/pdf" };
  throw new Error("Receipts must be a photo (JPG, PNG, HEIC) or a PDF.");
}

export async function uploadReceipt(file: File, onProgress: (fraction: number) => void): Promise<UploadedReceipt> {
  const { blob, name, mimeType } = await toUploadable(file);
  if (blob.size > 10 * 1024 * 1024) throw new Error("Each receipt must be under 10 MB.");

  const open = await fetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType, size: blob.size }),
  });
  const session = await open.json().catch(() => ({}));
  if (!open.ok) throw new Error(session.error ?? "Could not start the upload.");

  const fileId = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", session.uploadUrl);
    xhr.setRequestHeader("Content-Type", mimeType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(`Upload failed (${xhr.status}).`));
      try {
        const body = JSON.parse(xhr.responseText);
        if (typeof body.id !== "string") throw new Error();
        resolve(body.id);
      } catch {
        reject(new Error("Upload finished but no file id came back."));
      }
    };
    xhr.send(blob);
  });

  return { fileId, name, mimeType, size: blob.size };
}
