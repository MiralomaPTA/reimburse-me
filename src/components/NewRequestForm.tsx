"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { formatMoney, parseMoney } from "@/lib/money";
import { DEFAULT_POSITION, GRADE_LABELS, otherPosition, parseTeacherPosition, teacherPosition } from "@/lib/pta-position";
import { DESCRIPTION_MAX, fundingSplit, type FundingShare, type RequestInput } from "@/lib/request-schema";
import { uploadReceipt } from "@/lib/upload-client";
import type { PacketRecipient } from "@/server/config";
import type { FundingOptions, StipendStatus } from "@/server/requests/stipends";
import type { Profile } from "@/server/requests/profile";
import { MailtoLink } from "@/components/MailtoLink";
import { ReceiptUpload, type ReceiptState } from "@/components/ReceiptUpload";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { stipendLeft } from "@/components/StipendSummary";

interface ItemState {
  key: string;
  description: string;
  amount: string;
  receipts: ReceiptState[];
  /** A choice's id ("classroom", "grade:2", "none"), or "" until the requester picks; only asked when they have stipends. */
  funding: string;
}

/** Who is filling the form in, as far as the "about you" fields care. */
export interface Requester {
  /** Teachers are asked for grade and room instead of a free-text position. */
  teacher: boolean;
  /** The grades on their Users row as the form shows them ("2nd", "1st/2nd"), or "" when it names none. */
  grade: string;
}

interface FormState {
  payeeName: string;
  /** Non-teachers only; teachers build theirs from `grade` and `room`. */
  ptaPosition: string;
  grade: string;
  room: string;
  phone: string;
  checkDelivery: "pickup" | "mailbox";
  purpose: string;
  items: ItemState[];
  donation: string;
}

/**
 * Drafts saved before the stipend was chosen per line kept one choice for the whole request,
 * drafts from before pickup replaced mailing may still say "mail", and drafts from before
 * teachers were asked for grade and room have neither.
 */
type SavedForm = Omit<FormState, "checkDelivery" | "grade" | "room"> & {
  checkDelivery?: string;
  grade?: string;
  room?: string;
  funding?: string;
  items: (Omit<ItemState, "funding"> & { funding?: string })[];
};

/** Drafts before v2 were keyed per device, so one signed-in address could resume another's. */
const LEGACY_DRAFT_KEY = "rm:draft:v1";
/** One draft per signed-in address per device, so a shared computer doesn't hand one teacher's draft to the next. */
const draftKey = (email: string) => `rm:draft:v2:${email.trim().toLowerCase()}`;
const CONSENT_LABEL = "I agree to sign this reimbursement request electronically and certify the expenses and receipts are accurate.";

const newKey = () => Math.random().toString(36).slice(2, 10);
/** A new line takes the stipend of the line before it, so a request from one stipend is chosen once. */
const newItem = (funding = ""): ItemState => ({ key: newKey(), description: "", amount: "", receipts: [], funding });
/**
 * The "about you" fields from the last request. A teacher's grade and room come
 * back out of the position line they built last time, or start from their Users
 * row; a position that was only the default is left blank again.
 */
const emptyForm = (profile: Profile | null, requester: Requester): FormState => {
  const last = profile && requester.teacher ? parseTeacherPosition(profile.ptaPosition) : null;
  const position = profile?.ptaPosition ?? "";
  return {
    payeeName: profile?.payeeName ?? "",
    ptaPosition: requester.teacher || position === DEFAULT_POSITION ? "" : position,
    grade: last?.grade ?? requester.grade,
    room: last?.room ?? "",
    phone: profile?.phone ?? "",
    checkDelivery: profile?.checkDelivery ?? "mailbox",
    purpose: "",
    items: [newItem()],
    donation: "",
  };
};

function loadDraft(email: string, requester: Requester): FormState | null {
  try {
    // A pre-v2 draft can't be attributed to anyone, so it is dropped rather than resumed.
    localStorage.removeItem(LEGACY_DRAFT_KEY);
    const raw = localStorage.getItem(draftKey(email));
    if (!raw) return null;
    const { funding: legacyFunding, ...draft } = JSON.parse(raw) as SavedForm;
    // Only finished uploads survive a reload; anything mid-flight is dropped.
    const items: ItemState[] = draft.items.map((item) => ({
      ...item,
      receipts: item.receipts.filter((r) => r.status === "done" && r.fileId),
      funding: item.funding ?? legacyFunding ?? "",
    }));
    return {
      ...draft,
      grade: draft.grade ?? requester.grade,
      room: draft.room ?? "",
      checkDelivery: draft.checkDelivery === "mailbox" ? "mailbox" : "pickup",
      items: items.length > 0 ? items : [newItem()],
    };
  } catch {
    return null;
  }
}

function saveDraft(email: string, form: FormState) {
  try {
    localStorage.setItem(draftKey(email), JSON.stringify(form));
  } catch {
    /* storage unavailable: drafts just don't persist */
  }
}

function clearDraft(email: string) {
  try {
    localStorage.removeItem(draftKey(email));
  } catch {
    /* ignore */
  }
}

/** Converts form state to the API payload, collecting user-facing problems. */
function toRequestInput(form: FormState, stipends: StipendStatus[], requester: Requester): { input: RequestInput | null; problems: string[] } {
  const problems: string[] = [];
  const items: RequestInput["items"] = [];
  form.items.forEach((item, i) => {
    const n = i + 1;
    const amountCents = parseMoney(item.amount);
    if (!item.description.trim()) problems.push(`Line ${n}: describe the purchase.`);
    if (item.description.trim().length > DESCRIPTION_MAX) problems.push(`Line ${n}: keep the description under ${DESCRIPTION_MAX} characters.`);
    if (amountCents === null || amountCents <= 0) problems.push(`Line ${n}: enter the amount, like 12.50.`);
    const uploading = item.receipts.some((r) => r.status === "uploading");
    const done = item.receipts.filter((r) => r.status === "done" && r.fileId && r.mimeType);
    if (uploading) problems.push(`Line ${n}: wait for the receipt to finish uploading.`);
    else if (done.length === 0) problems.push(`Line ${n}: add a photo or PDF of the receipt.`);
    // A draft may name a stipend the requester no longer has; make them choose again.
    const funding = item.funding === "none" || stipends.some((s) => s.id === item.funding) ? item.funding : "";
    if (stipends.length > 0 && !funding) problems.push(`Line ${n}: choose which stipend it comes from, or "Not from a stipend".`);
    items.push({
      description: item.description.trim(),
      amountCents: amountCents ?? 0,
      receipts: done.map((r) => ({ fileId: r.fileId!, name: r.name, mimeType: r.mimeType! })),
      funding: stipends.length > 0 ? funding : "none",
    });
  });
  const donationCents = form.donation.trim() ? parseMoney(form.donation) : 0;
  if (donationCents === null) problems.push("Enter the donation as an amount, like 5.00, or leave it blank.");
  if (!form.payeeName.trim()) problems.push("Enter your name.");
  if (requester.teacher) {
    if (!form.grade.trim()) problems.push("Enter the grade you teach.");
    if (!form.room.trim()) problems.push("Enter your room number.");
  }
  if (form.phone.replace(/\D/g, "").length < 7) problems.push("Enter a phone number.");
  if (!form.purpose.trim()) problems.push("Say what the expenditure was for.");
  if (problems.length) return { input: null, problems };
  return {
    input: {
      payeeName: form.payeeName.trim(),
      ptaPosition: requester.teacher ? teacherPosition(form.grade, form.room) : otherPosition(form.ptaPosition),
      phone: form.phone.trim(),
      checkDelivery: form.checkDelivery,
      purpose: form.purpose.trim(),
      items,
      donationCents: donationCents ?? 0,
    },
    problems,
  };
}

type Step = "form" | "preview" | "done";

interface Issue {
  path?: (string | number)[];
  message: string;
}

function issueText(issues: Issue[]): string[] {
  return issues.map((issue) => {
    const path = issue.path ?? [];
    if (path[0] === "items" && typeof path[1] === "number") return `Line ${path[1] + 1}: ${issue.message}`;
    return issue.message;
  });
}

const noop = () => () => {};

/**
 * Renders the form only on the client, so the saved draft can seed its initial
 * state without a hydration mismatch. A draft in progress wins; otherwise the
 * "about you" fields start from the requester's last request.
 */
export function NewRequestForm({
  email,
  apEmail,
  sendPacketsTo,
  profile,
  requester,
  funding,
}: {
  email: string;
  apEmail: string;
  sendPacketsTo: PacketRecipient;
  profile: Profile | null;
  requester: Requester;
  funding: FundingOptions;
}) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return <p className="text-neutral-500">Loading…</p>;
  const draft = loadDraft(email, requester);
  return (
    <RequestForm
      email={email}
      apEmail={apEmail}
      sendPacketsTo={sendPacketsTo}
      profile={profile}
      requester={requester}
      funding={funding}
      initialForm={draft ?? emptyForm(profile, requester)}
      prefilled={!draft && profile !== null}
    />
  );
}

interface RequestFormProps {
  email: string;
  apEmail: string;
  /** Whether the signed packet went to AP, or only to the requester to forward by hand. */
  sendPacketsTo: PacketRecipient;
  profile: Profile | null;
  requester: Requester;
  /** The requester's stipends before this request; none means the form doesn't ask. */
  funding: FundingOptions;
  initialForm: FormState;
  /** True when the "about you" fields came from the last request rather than a draft. */
  prefilled: boolean;
}

function RequestForm({ email, apEmail, sendPacketsTo, profile, requester, funding: initialFunding, initialForm, prefilled }: RequestFormProps) {
  const [form, setForm] = useState<FormState>(initialForm);
  // After a submission, "Start another" prefills from what was just sent.
  const latestProfile = useRef<Profile | null>(profile);
  // ...and counts it against the stipend it came from.
  const [funding, setFunding] = useState<FundingOptions>(initialFunding);
  const [step, setStep] = useState<Step>("form");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState<null | "preview" | "submit">(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [requestInput, setRequestInput] = useState<RequestInput | null>(null);
  const [consent, setConsent] = useState(false);
  const [signMode, setSignMode] = useState<"typed" | "drawn">("typed");
  const [typedName, setTypedName] = useState("");
  const [result, setResult] = useState<{ requestId: string; emailed: boolean; shares: FundingShare[] } | null>(null);
  const padRef = useRef<SignaturePadHandle>(null);

  useEffect(() => {
    if (step !== "done") saveDraft(email, form);
  }, [email, form, step]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value })), []);

  const updateItem = useCallback((key: string, patch: Partial<ItemState>) => {
    setForm((f) => ({ ...f, items: f.items.map((item) => (item.key === key ? { ...item, ...patch } : item)) }));
  }, []);

  const updateReceipt = useCallback((itemKey: string, receiptKey: string, patch: Partial<ReceiptState>) => {
    setForm((f) => ({
      ...f,
      items: f.items.map((item) =>
        item.key === itemKey ? { ...item, receipts: item.receipts.map((r) => (r.key === receiptKey ? { ...r, ...patch } : r)) } : item,
      ),
    }));
  }, []);

  const addFiles = useCallback(
    (itemKey: string, files: File[]) => {
      for (const file of files) {
        const receiptKey = newKey();
        setForm((f) => ({
          ...f,
          items: f.items.map((item) =>
            item.key === itemKey
              ? { ...item, receipts: [...item.receipts, { key: receiptKey, name: file.name, size: file.size, status: "uploading", progress: 0 }] }
              : item,
          ),
        }));
        uploadReceipt(file, (fraction) => updateReceipt(itemKey, receiptKey, { progress: fraction }))
          .then((uploaded) =>
            updateReceipt(itemKey, receiptKey, { status: "done", progress: 1, fileId: uploaded.fileId, name: uploaded.name, mimeType: uploaded.mimeType, size: uploaded.size }),
          )
          .catch((error: unknown) =>
            updateReceipt(itemKey, receiptKey, { status: "error", error: error instanceof Error ? error.message : "Upload failed" }),
          );
      }
    },
    [updateReceipt],
  );

  const removeReceipt = useCallback((itemKey: string, receiptKey: string) => {
    setForm((f) => ({
      ...f,
      items: f.items.map((item) => (item.key === itemKey ? { ...item, receipts: item.receipts.filter((r) => r.key !== receiptKey) } : item)),
    }));
  }, []);

  /** Puts a receipt already uploaded for another line on this one too: one receipt split between stipends. */
  const shareReceipt = useCallback((itemKey: string, receipt: ReceiptState) => {
    setForm((f) => ({
      ...f,
      items: f.items.map((item) => (item.key === itemKey ? { ...item, receipts: [...item.receipts, { ...receipt, key: newKey() }] } : item)),
    }));
  }, []);

  const totals = useMemo(() => {
    const total = form.items.reduce((sum, item) => sum + (parseMoney(item.amount) ?? 0), 0);
    const donation = parseMoney(form.donation) ?? 0;
    return { total, donation, claimed: Math.max(0, total - donation) };
  }, [form.items, form.donation]);

  // What this request takes from each stipend, as the form stands.
  const shares = useMemo(
    () =>
      fundingSplit({
        items: form.items.map((item) => ({ amountCents: parseMoney(item.amount) ?? 0, funding: item.funding })),
        donationCents: parseMoney(form.donation) ?? 0,
      }).filter((share) => share.funding),
    [form.items, form.donation],
  );

  async function preview() {
    const { input, problems: found } = toRequestInput(form, funding.stipends, requester);
    setProblems(found);
    if (!input) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setBusy("preview");
    try {
      const response = await fetch("/api/requests/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setProblems(body.issues ? issueText(body.issues) : [body.error ?? "Could not build the preview."]);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      const blob = await response.blob();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
      setRequestInput(input);
      setTypedName((name) => name || input.payeeName);
      setStep("preview");
      window.scrollTo({ top: 0 });
    } catch {
      setProblems(["Could not build the preview. Check your connection and try again."]);
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    if (!requestInput) return;
    const signature =
      signMode === "typed" ? { type: "typed" as const, name: typedName.trim() } : { type: "drawn" as const, pngDataUrl: padRef.current?.toDataUrl() ?? "" };
    const found: string[] = [];
    if (!consent) found.push("Tick the box to sign electronically.");
    if (signature.type === "typed" && signature.name.length < 2) found.push("Type your full name as your signature.");
    if (signature.type === "drawn" && !signature.pngDataUrl) found.push("Draw your signature, or switch to typing your name.");
    setProblems(found);
    if (found.length) return;

    setBusy("submit");
    try {
      const response = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: requestInput, signature, consent: true }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblems(body.issues ? issueText(body.issues) : [body.error ?? "Could not submit."]);
        return;
      }
      clearDraft(email);
      latestProfile.current = {
        payeeName: requestInput.payeeName,
        ptaPosition: requestInput.ptaPosition,
        phone: requestInput.phone,
        checkDelivery: requestInput.checkDelivery,
      };
      if (body.funding) setFunding(body.funding);
      setResult({ requestId: body.requestId, emailed: body.emailed, shares: fundingSplit(requestInput) });
      setStep("done");
      window.scrollTo({ top: 0 });
    } catch {
      setProblems(["Could not submit. Check your connection and try again."]);
    } finally {
      setBusy(null);
    }
  }

  function startAnother() {
    setForm(emptyForm(latestProfile.current, requester));
    setRequestInput(null);
    setConsent(false);
    setTypedName("");
    setResult(null);
    setProblems([]);
    setStep("form");
  }

  /** Throws away the in-progress draft; the "about you" fields start over from the last request. */
  function discardDraft() {
    if (!window.confirm("Discard this draft? Anything you've entered, including uploaded receipts, will be removed from the form.")) return;
    clearDraft(email);
    setForm(emptyForm(latestProfile.current, requester));
    setProblems([]);
    window.scrollTo({ top: 0 });
  }

  /** The stipends `shares` draws on, with each share, in the form's order. */
  const drawnOn = (from: FundingShare[]) =>
    from.flatMap((share) => {
      const stipend = funding.stipends.find((s) => s.id === share.funding);
      return stipend ? [{ stipend, share }] : [];
    });
  /** "Classroom stipend $40.00, Grade 2 stipend $50.00", or just the label when one choice covers the request. */
  const fundingSummary = (from: FundingShare[]) => {
    const label = (id: string) => (id === "none" ? "Not from a stipend" : (funding.stipends.find((s) => s.id === id)?.label ?? id));
    if (from.length === 1) return label(from[0].funding);
    return from.map((share) => `${label(share.funding)} ${formatMoney(share.claimedCents)}`).join(", ");
  };

  if (step === "done" && result) {
    const toAp = sendPacketsTo === "ap";
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-2xl font-semibold">{toAp ? "Sent to the PTA" : "Signed and ready to send"}</h1>
        {toAp ? (
          <p className="text-neutral-700">
            Your request <strong>{result.requestId}</strong> is signed and on its way to the accounts payable team.
            {result.emailed ? ` A copy went to ${email}.` : ""}
          </p>
        ) : (
          <p className="text-neutral-700">
            Your request <strong>{result.requestId}</strong> is signed.
            {result.emailed ? ` The PDF was emailed to ${email}.` : ""} The portal hasn&apos;t sent it to the PTA: to be reimbursed, forward that email,
            with the PDF attached, to <MailtoLink email={apEmail} />.
          </p>
        )}
        {drawnOn(result.shares).map(({ stipend }) => {
          const left = stipendLeft(stipend);
          return left ? (
            <p key={stipend.id} className="text-neutral-700">
              {stipend.label}: {left}.
            </p>
          ) : null;
        })}
        {!result.emailed && toAp && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            The request was recorded, but the email to the AP team didn&apos;t go through. Please let <MailtoLink email={apEmail} /> know your
            request number so they can pick it up from the log.
          </p>
        )}
        {!result.emailed && !toAp && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            The request was recorded, but the email with your PDF didn&apos;t go through. Open the request below, download the signed PDF and
            email it to <MailtoLink email={apEmail} /> yourself.
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Link href={`/requests/${result.requestId}`} className="btn-primary">
            View request
          </Link>
          <button type="button" className="btn-secondary" onClick={startAnother}>
            Start another
          </button>
        </div>
      </div>
    );
  }

  const problemBox = problems.length > 0 && (
    <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
      <ul className="list-disc space-y-1 pl-5">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );

  if (step === "preview" && previewUrl && requestInput) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Check and sign</h1>
          <p className="text-neutral-600">This is the packet the PTA will receive. If anything is wrong, go back and fix it.</p>
        </div>
        {problemBox}
        <div className="card p-2">
          <iframe src={previewUrl} title="Preview of your reimbursement packet" className="h-[70vh] w-full rounded" />
          <div className="flex items-center justify-between px-2 pt-2 text-sm">
            <a href={previewUrl} target="_blank" rel="noopener" className="underline">
              Open preview in a new tab
            </a>
            <span className="text-neutral-500">
              Reimbursement claimed: {formatMoney(totals.claimed)}
              {funding.stipends.length > 0 && shares.length > 0 ? ` · ${fundingSummary(shares)}` : ""}
            </span>
          </div>
        </div>

        <div className="card space-y-4">
          <h2 className="text-lg font-semibold">Sign</h2>
          <div className="flex gap-2">
            <button type="button" className={signMode === "typed" ? "btn-primary" : "btn-secondary"} onClick={() => setSignMode("typed")}>
              Type my name
            </button>
            <button type="button" className={signMode === "drawn" ? "btn-primary" : "btn-secondary"} onClick={() => setSignMode("drawn")}>
              Draw
            </button>
          </div>
          {signMode === "typed" ? (
            <div>
              <label htmlFor="typedName" className="label">
                Full name
              </label>
              <input id="typedName" className="field italic" value={typedName} onChange={(e) => setTypedName(e.target.value)} autoComplete="name" />
            </div>
          ) : (
            <SignaturePad ref={padRef} />
          )}
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{CONSENT_LABEL}</span>
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-primary" onClick={submit} disabled={busy === "submit"}>
              {busy === "submit" ? "Submitting…" : "Sign and submit"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setStep("form")} disabled={busy === "submit"}>
              Back to edit
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void preview();
      }}
    >
      <div>
        <h1 className="text-2xl font-semibold">New reimbursement request</h1>
        <p className="text-neutral-600">
          One line per receipt. Photograph each receipt as you go.
          {funding.stipends.length > 0 ? " To split one receipt between stipends, add a line for each stipend's share and attach the receipt to both." : ""}
        </p>
      </div>
      {problemBox}

      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">About you</h2>
        {prefilled && <p className="text-sm text-neutral-500">Filled in from your last request. Change anything that&apos;s different this time.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="payeeName" className="label">
              Name
            </label>
            <input id="payeeName" className="field" autoComplete="name" value={form.payeeName} onChange={(e) => update("payeeName", e.target.value)} />
          </div>
          {requester.teacher ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="grade" className="label">
                  Grade
                </label>
                <input id="grade" className="field" list="grade-labels" placeholder="2nd" value={form.grade} onChange={(e) => update("grade", e.target.value)} />
                <datalist id="grade-labels">
                  {GRADE_LABELS.map((label) => (
                    <option key={label} value={label} />
                  ))}
                </datalist>
              </div>
              <div>
                <label htmlFor="room" className="label">
                  Room
                </label>
                <input id="room" className="field" placeholder="106" value={form.room} onChange={(e) => update("room", e.target.value)} />
              </div>
            </div>
          ) : (
            <div>
              <label htmlFor="ptaPosition" className="label">
                PTA position <span className="font-normal text-neutral-500">(optional)</span>
              </label>
              <input
                id="ptaPosition"
                className="field"
                placeholder={DEFAULT_POSITION}
                value={form.ptaPosition}
                onChange={(e) => update("ptaPosition", e.target.value)}
                aria-describedby="ptaPosition_help"
              />
              <p id="ptaPosition_help" className="mt-1 text-xs text-neutral-500">
                Leave it blank and the form will say &quot;{DEFAULT_POSITION}&quot;, or put your role, like &quot;Librarian&quot; or &quot;Fall Festival chair&quot;.
              </p>
            </div>
          )}
          <div>
            <label htmlFor="phone" className="label">
              Phone
            </label>
            <input id="phone" className="field" type="tel" autoComplete="tel" inputMode="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)} />
          </div>
          <div>
            <label htmlFor="requesterEmail" className="label">Email</label>
            <input id="requesterEmail" className="field bg-neutral-100" value={email} readOnly />
          </div>
        </div>
        <fieldset>
          <legend className="label">How should you get the check?</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="checkDelivery" checked={form.checkDelivery === "mailbox"} onChange={() => update("checkDelivery", "mailbox")} />
              Leave it in my staff mailbox
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="checkDelivery" checked={form.checkDelivery === "pickup"} onChange={() => update("checkDelivery", "pickup")} />
              Arrange pickup with the PTA
            </label>
          </div>
        </fieldset>
      </section>

      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">What was it for?</h2>
        <div>
          <label htmlFor="purpose" className="label">
            Expenditure was for
          </label>
          <input id="purpose" className="field" placeholder="2nd grade art supplies" maxLength={60} value={form.purpose} onChange={(e) => update("purpose", e.target.value)} />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Receipts</h2>
        {form.items.map((item, index) => (
          <div key={item.key} className="card space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Line {index + 1}</h3>
              {form.items.length > 1 && (
                <button type="button" className="text-sm text-neutral-500 hover:text-red-700" onClick={() => update("items", form.items.filter((i) => i.key !== item.key))}>
                  Remove line
                </button>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <div>
                <label htmlFor={`desc-${item.key}`} className="label">
                  Description <span className="font-normal text-neutral-500">({item.description.length}/{DESCRIPTION_MAX})</span>
                </label>
                <input
                  id={`desc-${item.key}`}
                  className="field"
                  placeholder="Target, markers and paper"
                  maxLength={DESCRIPTION_MAX}
                  value={item.description}
                  onChange={(e) => updateItem(item.key, { description: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor={`amt-${item.key}`} className="label">
                  Amount
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-neutral-500">$</span>
                  <input
                    id={`amt-${item.key}`}
                    className="field pl-7"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={item.amount}
                    onChange={(e) => updateItem(item.key, { amount: e.target.value })}
                  />
                </div>
              </div>
            </div>
            {funding.stipends.length > 0 && (
              <div>
                <label htmlFor={`funding-${item.key}`} className="label">
                  Paid from
                </label>
                <select id={`funding-${item.key}`} className="field" value={item.funding} onChange={(e) => updateItem(item.key, { funding: e.target.value })}>
                  <option value="" disabled>
                    Choose a stipend…
                  </option>
                  {funding.stipends.map((stipend) => (
                    <option key={stipend.id} value={stipend.id}>
                      {stipend.label}
                      {stipend.sharedWith ? ` (shared with ${stipend.sharedWith})` : ""}
                      {stipendLeft(stipend) ? ` · ${stipendLeft(stipend)}` : ""}
                    </option>
                  ))}
                  <option value="none">Not from a stipend</option>
                </select>
              </div>
            )}
            <div>
              <div className="label">Receipt</div>
              <ReceiptUpload receipts={item.receipts} onFiles={(files) => addFiles(item.key, files)} onRemove={(key) => removeReceipt(item.key, key)} />
              <ShareReceipt items={form.items} item={item} onShare={(receipt) => shareReceipt(item.key, receipt)} />
              <p className="mt-2 text-xs text-neutral-500">
                Tip: cover or crop card numbers and home addresses before you upload. A long receipt can be several photos.
              </p>
            </div>
          </div>
        ))}
        <button type="button" className="btn-secondary" onClick={() => update("items", [...form.items, newItem(form.items[form.items.length - 1]?.funding ?? "")])}>
          + Add another receipt
        </button>
      </section>

      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">Totals</h2>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-neutral-600">Total expense</dt>
          <dd className="text-right font-medium">{formatMoney(totals.total)}</dd>
          <dt className="text-neutral-600">
            <label htmlFor="donation">Not claimed, donate to PTA (optional)</label>
          </dt>
          <dd className="text-right">
            <input id="donation" className="field w-32 text-right" inputMode="decimal" placeholder="0.00" value={form.donation} onChange={(e) => update("donation", e.target.value)} />
          </dd>
          <dt className="font-medium">Reimbursement claimed</dt>
          <dd className="text-right text-lg font-semibold">{formatMoney(totals.claimed)}</dd>
        </dl>
        {drawnOn(shares).map(({ stipend, share }) => stipend.remainingCents !== null && <StipendAfter key={stipend.id} stipend={stipend} claimedCents={share.claimedCents} />)}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={busy === "preview"}>
          {busy === "preview" ? "Building preview…" : "Preview and sign"}
        </button>
        <span className="text-sm text-neutral-500">Your draft is saved on this device.</span>
        <button type="button" onClick={discardDraft} className="text-sm text-neutral-500 underline hover:text-red-700">
          Discard draft
        </button>
      </div>
    </form>
  );
}

/**
 * Offers the finished uploads of the other lines, so one receipt split between
 * stipends is uploaded once and attached to each line. Nothing is shown when
 * there is nothing to offer.
 */
function ShareReceipt({ items, item, onShare }: { items: ItemState[]; item: ItemState; onShare: (receipt: ReceiptState) => void }) {
  // Each file once, under the first line that has it, and never one this line already has.
  const seen = new Set(item.receipts.map((r) => r.fileId).filter(Boolean));
  const offered: { line: number; receipt: ReceiptState }[] = [];
  items.forEach((other, index) => {
    if (other.key === item.key) return;
    for (const receipt of other.receipts) {
      if (receipt.status !== "done" || !receipt.fileId || seen.has(receipt.fileId)) continue;
      seen.add(receipt.fileId);
      offered.push({ line: index + 1, receipt });
    }
  });
  if (offered.length === 0) return null;
  return (
    <select
      className="field mt-2 text-sm"
      value=""
      aria-label="Attach a receipt from another line"
      onChange={(e) => {
        const found = offered.find(({ receipt }) => receipt.key === e.target.value);
        if (found) onShare(found.receipt);
      }}
    >
      <option value="">Same receipt as another line…</option>
      {offered.map(({ line, receipt }) => (
        <option key={receipt.key} value={receipt.key}>
          Line {line}: {receipt.name}
        </option>
      ))}
    </select>
  );
}

/** What's left of the chosen stipend, before and after this request. A warning, never a block: AP decides. */
function StipendAfter({ stipend, claimedCents }: { stipend: StipendStatus; claimedCents: number }) {
  const before = stipend.remainingCents ?? 0;
  const afterCents = before - claimedCents;
  return (
    <div className="space-y-2 border-t border-neutral-200 pt-4">
      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-neutral-600">Left in {stipend.label.toLowerCase()}</dt>
        <dd className="text-right">{formatMoney(before)}</dd>
        <dt className="text-neutral-600">From it in this request</dt>
        <dd className="text-right">{formatMoney(claimedCents)}</dd>
        <dt className="text-neutral-600">Left after this request</dt>
        <dd className={`text-right font-medium ${afterCents < 0 ? "text-amber-800" : ""}`}>{formatMoney(afterCents)}</dd>
      </dl>
      {afterCents < 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          This is {formatMoney(Math.min(-afterCents, claimedCents))} more than what&apos;s left in the {stipend.label.toLowerCase()}. You can still submit it;
          the AP team will decide what to reimburse.
        </p>
      )}
    </div>
  );
}
