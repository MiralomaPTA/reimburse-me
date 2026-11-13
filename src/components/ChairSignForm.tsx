"use client";

import { useRef, useState } from "react";
import type { PacketRecipient } from "@/server/config";
import { chairConsentText } from "@/server/pdf/types";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";

/** The event chair's signing step: their name, a typed or drawn signature, consent, and an optional note to AP. */
export function ChairSignForm({
  requestId,
  token,
  event,
  payeeName,
  pdfHref,
  sendPacketsTo,
}: {
  requestId: string;
  token: string;
  event: string;
  payeeName: string;
  /** The packet; once signed, the same link serves the co-signed one. */
  pdfHref: string;
  sendPacketsTo: PacketRecipient;
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"typed" | "drawn">("typed");
  const [consent, setConsent] = useState(false);
  const [note, setNote] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ emailed: boolean } | null>(null);
  const padRef = useRef<SignaturePadHandle>(null);

  async function sign() {
    const signature = mode === "typed" ? { type: "typed" as const, name: name.trim() } : { type: "drawn" as const, pngDataUrl: padRef.current?.toDataUrl() ?? "" };
    const found: string[] = [];
    if (name.trim().length < 2) found.push("Enter your full name.");
    if (signature.type === "drawn" && !signature.pngDataUrl) found.push("Draw your signature, or switch to typing your name.");
    if (!consent) found.push("Tick the box to sign electronically.");
    setProblems(found);
    if (found.length) return;

    setBusy(true);
    try {
      const response = await fetch("/api/chair/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, token, name: name.trim(), signature, consent: true, note: note.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblems([body.error ?? "Could not sign. Please try again."]);
        return;
      }
      setDone({ emailed: body.emailed !== false });
      window.scrollTo({ top: 0 });
    } catch {
      setProblems(["Could not sign. Check your connection and try again."]);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-3 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-emerald-900">
        <h2 className="text-lg font-semibold">Signed. Thank you!</h2>
        <p className="text-sm">
          {sendPacketsTo === "ap"
            ? `Request ${requestId} has gone to the PTA's accounts payable team with your signature on it.`
            : `${payeeName} has been sent the co-signed request to send on to the PTA.`}{" "}
          We emailed you a copy for your records.
        </p>
        {!done.emailed && (
          <p className="text-sm text-amber-900">
            Your signature was saved, but an email didn&apos;t go out. Please let {payeeName} know it&apos;s signed.
          </p>
        )}
        <a href={pdfHref} target="_blank" rel="noopener" className="btn-secondary">
          Open the co-signed PDF
        </a>
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <h2 className="text-lg font-semibold">Sign as {event} chair</h2>
      {problems.length > 0 && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <ul className="list-disc space-y-1 pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <label htmlFor="chairName" className="label">
          Your full name
        </label>
        <input id="chairName" className="field" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-describedby="chairName_help" />
        <p id="chairName_help" className="mt-1 text-xs text-neutral-500">
          Printed beside your signature on the form, with today&apos;s date.
        </p>
      </div>
      <div className="flex gap-2">
        <button type="button" className={mode === "typed" ? "btn-primary" : "btn-secondary"} onClick={() => setMode("typed")}>
          Type my name
        </button>
        <button type="button" className={mode === "drawn" ? "btn-primary" : "btn-secondary"} onClick={() => setMode("drawn")}>
          Draw
        </button>
      </div>
      {mode === "typed" ? (
        <p className="rounded-md border border-dashed border-neutral-300 px-3 py-2 text-lg italic text-neutral-800">{name.trim() || "Your name"}</p>
      ) : (
        <SignaturePad ref={padRef} />
      )}
      <div>
        <label htmlFor="chairNote" className="label">
          Note to the PTA <span className="font-normal text-neutral-500">(optional)</span>
        </label>
        <textarea id="chairNote" className="field" rows={2} maxLength={500} placeholder="For example: bought for the water station" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{chairConsentText(event)}</span>
      </label>
      <button type="button" className="btn-primary" onClick={sign} disabled={busy}>
        {busy ? "Signing…" : "Sign"}
      </button>
    </div>
  );
}
