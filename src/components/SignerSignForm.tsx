"use client";

import { useRef, useState } from "react";
import { BUDGET_ACCOUNT_MAX } from "@/lib/mailing";
import { SIGNER_CONSENT_TEXT } from "@/server/pdf/types";
import type { Accounts } from "@/server/requests/signers";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";

type Done = { kind: "signed"; slot: 1 | 2; emailed: boolean; receipted: boolean } | { kind: "sent-back"; emailed: boolean };

/**
 * A check signer's two choices: sign their Authorized By line (the first
 * signer also confirms the Budget Account and picks the Payment Account), or
 * send the request back with a note. The name they type goes with either.
 */
export function SignerSignForm({
  requestId,
  token,
  slot,
  version,
  payeeName,
  accounts,
  billPayAccounts,
}: {
  requestId: string;
  token: string;
  /** The line this signer would sign, as the page showed it. */
  slot: 1 | 2;
  version: number;
  payeeName: string;
  accounts: Accounts;
  billPayAccounts: string[];
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"typed" | "drawn">("typed");
  const [consent, setConsent] = useState(false);
  const [note, setNote] = useState("");
  const [budgetAccount, setBudgetAccount] = useState(accounts.budgetAccount);
  const [paymentAccount, setPaymentAccount] = useState(accounts.paymentAccount);
  const [sendBackNote, setSendBackNote] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [reload, setReload] = useState(false);
  /** Where the problems are shown: by the button that was pressed. */
  const [pressed, setPressed] = useState<"sign" | "send-back">("sign");
  const [busy, setBusy] = useState<null | "sign" | "send-back">(null);
  const [done, setDone] = useState<Done | null>(null);
  const padRef = useRef<SignaturePadHandle>(null);

  async function post(path: string, body: object): Promise<Record<string, unknown> | null> {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      setProblems([typeof result.error === "string" ? result.error : "That didn't work. Please try again."]);
      setReload(result.reload === true);
      return null;
    }
    return result;
  }

  async function sign() {
    const signature = mode === "typed" ? { type: "typed" as const, name: name.trim() } : { type: "drawn" as const, pngDataUrl: padRef.current?.toDataUrl() ?? "" };
    const found: string[] = [];
    if (name.trim().length < 2) found.push("Enter your full name.");
    if (!accounts.locked && !budgetAccount.trim()) found.push("Enter the Budget Account the payment comes from.");
    if (signature.type === "drawn" && !signature.pngDataUrl) found.push("Draw your signature, or switch to typing your name.");
    if (!consent) found.push("Tick the box to sign electronically.");
    setPressed("sign");
    setProblems(found);
    setReload(false);
    if (found.length) return;
    setBusy("sign");
    try {
      const result = await post("/api/signers/sign", {
        requestId,
        token,
        slot,
        version,
        name: name.trim(),
        signature,
        consent: true,
        note: note.trim(),
        ...(accounts.locked ? {} : { budgetAccount: budgetAccount.trim(), paymentAccount }),
      });
      if (result) {
        setDone({ kind: "signed", slot, emailed: result.emailed !== false, receipted: result.receipted !== false });
        window.scrollTo({ top: 0 });
      }
    } catch {
      setProblems(["Could not sign. Check your connection and try again."]);
    } finally {
      setBusy(null);
    }
  }

  async function sendBack() {
    const found: string[] = [];
    if (name.trim().length < 2) found.push("Enter your full name.");
    if (!sendBackNote.trim()) found.push("Say what needs to change, so it can be fixed.");
    setPressed("send-back");
    setProblems(found);
    setReload(false);
    if (found.length) return;
    setBusy("send-back");
    try {
      const result = await post("/api/signers/send-back", { requestId, token, slot, version, name: name.trim(), note: sendBackNote.trim() });
      if (result) {
        setDone({ kind: "sent-back", emailed: result.emailed !== false });
        window.scrollTo({ top: 0 });
      }
    } catch {
      setProblems(["Could not send it back. Check your connection and try again."]);
    } finally {
      setBusy(null);
    }
  }

  if (done?.kind === "signed") {
    return (
      <div className="space-y-3 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-emerald-900">
        <h2 className="text-lg font-semibold">Signed. Thank you!</h2>
        {done.emailed ? (
          <p className="text-sm">
            {done.slot === 1
              ? "One more check signer signs next; they've been emailed. Then it goes to the PTA's accounts payable team, who set up the payment."
              : `That was the second signature. Request ${requestId} has gone to the PTA's accounts payable team, who set up the payment.`}
          </p>
        ) : done.slot === 2 ? (
          <p className="text-sm text-amber-900">
            Your signature was saved, but the email to the PTA&apos;s accounts payable team didn&apos;t go out. {payeeName} can send it again from their request page, and the
            PTA&apos;s records note it.
          </p>
        ) : (
          <p className="text-sm text-amber-900">Your signature was saved, but an email sending it on didn&apos;t go out. The PTA has been told in its records.</p>
        )}
        <p className="text-sm">{done.receipted ? "We emailed you a receipt, with the FO10 as you signed it." : "We couldn't email you a receipt, but your signature is saved."}</p>
      </div>
    );
  }
  if (done?.kind === "sent-back") {
    return (
      <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-950">
        <h2 className="text-lg font-semibold">Sent back</h2>
        <p className="text-sm">
          {done.emailed
            ? `${payeeName} and the PTA's accounts payable team have your note. The request is closed and won't be paid; ${payeeName} can start a new one.`
            : `The request is sent back and won't be paid, but the email with your note didn't go out. Please let ${payeeName} know.`}
        </p>
      </div>
    );
  }

  const problemBox = problems.length > 0 && (
    <div className="space-y-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
      <ul className="list-disc space-y-1 pl-5">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      {reload && (
        <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>
          Reload the page
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="card space-y-4">
        <h2 className="text-lg font-semibold">Sign the {slot === 1 ? "first" : "second"} Authorized By line</h2>
        {pressed === "sign" && problemBox}
        {!accounts.locked && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="budgetAccount" className="label">
                Budget Account
              </label>
              <input
                id="budgetAccount"
                className="field"
                value={budgetAccount}
                onChange={(e) => setBudgetAccount(e.target.value)}
                aria-describedby="budgetAccount_help"
              />
              <p id="budgetAccount_help" className="mt-1 text-xs text-neutral-500">
                {accounts.budgetAccount ? "Filled in from the request. Correct it if it's wrong." : "The request doesn't say; fill it in."} Up to {BUDGET_ACCOUNT_MAX}{" "}
                characters. Locked once you sign.
              </p>
            </div>
            <div>
              <label htmlFor="paymentAccount" className="label">
                Payment Account
              </label>
              {billPayAccounts.length > 1 ? (
                <select id="paymentAccount" className="field" value={paymentAccount} onChange={(e) => setPaymentAccount(e.target.value)}>
                  {billPayAccounts.map((account) => (
                    <option key={account} value={account}>
                      {account}
                    </option>
                  ))}
                </select>
              ) : (
                <p id="paymentAccount" className="field bg-neutral-100">
                  {paymentAccount}
                </p>
              )}
              <p className="mt-1 text-xs text-neutral-500">The PTA account the payment comes from.</p>
            </div>
          </div>
        )}
        <div>
          <label htmlFor="signerName" className="label">
            Your full name
          </label>
          <input id="signerName" className="field" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-describedby="signerName_help" />
          <p id="signerName_help" className="mt-1 text-xs text-neutral-500">
            Printed beside your signature on the FO10, with today&apos;s date.
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
          <label htmlFor="signerNote" className="label">
            Note to the PTA <span className="font-normal text-neutral-500">(optional)</span>
          </label>
          <textarea id="signerNote" className="field" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{SIGNER_CONSENT_TEXT}</span>
        </label>
        <button type="button" className="btn-primary" onClick={sign} disabled={busy !== null}>
          {busy === "sign" ? "Signing…" : "Sign"}
        </button>
      </div>

      <details className="card">
        <summary className="cursor-pointer font-medium">Something not right? Send it back</summary>
        <div className="mt-4 space-y-3">
          <p className="text-sm text-neutral-600">
            {payeeName} and the PTA&apos;s accounts payable team get your note, and the request is closed: nobody else can sign it. Uses the name you typed above.
          </p>
          <label htmlFor="sendBackNote" className="label">
            What needs to change?
          </label>
          <textarea id="sendBackNote" className="field" rows={3} maxLength={1000} value={sendBackNote} onChange={(e) => setSendBackNote(e.target.value)} />
          {pressed === "send-back" && problemBox}
          <button type="button" className="btn-secondary" onClick={sendBack} disabled={busy !== null}>
            {busy === "send-back" ? "Sending back…" : "Send back"}
          </button>
        </div>
      </details>
    </div>
  );
}
