"use client";

import { useRef } from "react";

export interface ReceiptState {
  key: string;
  fileId?: string;
  name: string;
  mimeType?: "image/jpeg" | "image/png" | "application/pdf";
  size: number;
  status: "uploading" | "done" | "error";
  progress: number;
  error?: string;
}

interface Props {
  receipts: ReceiptState[];
  onFiles(files: File[]): void;
  onRemove(key: string): void;
}

/** Where a finished upload can be opened; the route only serves the uploader's own files. */
const viewUrl = (fileId: string) => `/api/uploads/${encodeURIComponent(fileId)}`;

/** Two pickers (camera and files) plus the list of receipts for one line item. Finished uploads open in a new tab. */
export function ReceiptUpload({ receipts, onFiles, onRemove }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function pick(input: HTMLInputElement | null) {
    if (!input?.files?.length) return;
    onFiles(Array.from(input.files));
    input.value = "";
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => cameraRef.current?.click()}>
          Take photo
        </button>
        <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>
          Choose file
        </button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target)} />
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/heic,image/heif,application/pdf,.heic,.heif,.pdf"
          multiple
          className="hidden"
          onChange={(e) => pick(e.target)}
        />
      </div>
      {receipts.length > 0 && (
        <ul className="mt-3 space-y-2">
          {receipts.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                {r.status === "done" && r.fileId ? (
                  <a href={viewUrl(r.fileId)} target="_blank" rel="noopener" className="block truncate text-blue-700 underline hover:text-blue-900">
                    {r.name}
                  </a>
                ) : (
                  <div className="truncate">{r.name}</div>
                )}
                {r.status === "uploading" && (
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-neutral-200">
                    <div className="h-full bg-blue-600 transition-all" style={{ width: `${Math.round(r.progress * 100)}%` }} />
                  </div>
                )}
                {r.status === "error" && <div className="text-red-700">{r.error}</div>}
                {r.status === "done" && <div className="text-neutral-500">Uploaded</div>}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {r.status === "done" && r.fileId && (
                  <a href={viewUrl(r.fileId)} target="_blank" rel="noopener" className="text-blue-700 hover:text-blue-900" aria-label={`View ${r.name}`}>
                    View
                  </a>
                )}
                <button type="button" onClick={() => onRemove(r.key)} className="text-neutral-500 hover:text-red-700" aria-label={`Remove ${r.name}`}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
