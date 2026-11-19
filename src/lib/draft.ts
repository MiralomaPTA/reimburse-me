/**
 * Where the new-request form keeps its in-progress draft on this device, and
 * whether there is one worth offering to resume.
 */

/** Drafts before v2 were keyed per device, so one signed-in address could resume another's. */
export const LEGACY_DRAFT_KEY = "rm:draft:v1";
/**
 * One draft per signed-in address per device, so a shared computer doesn't
 * hand one teacher's draft to the next. A returned request being fixed keeps
 * its own, `scope` naming the request and the version it was filled from
 * ("FY27-042:v1"), so it never replaces the new-request draft, and a draft
 * for an earlier version isn't offered once that version was signed again.
 */
export const draftKey = (email: string, scope = "") => `rm:draft:v2:${email.trim().toLowerCase()}${scope ? `:fix:${scope}` : ""}`;
/** Fired in this tab when the draft changes; other tabs hear the browser's `storage` event instead. */
const DRAFT_CHANGED = "rm:draft-changed";

export function readDraft(email: string, scope = ""): string | null {
  try {
    return localStorage.getItem(draftKey(email, scope));
  } catch {
    return null;
  }
}

export function writeDraft(email: string, draft: unknown, scope = "") {
  try {
    localStorage.setItem(draftKey(email, scope), JSON.stringify(draft));
  } catch {
    /* storage unavailable: drafts just don't persist */
  }
  window.dispatchEvent(new Event(DRAFT_CHANGED));
}

export function removeDraft(email: string, scope = "") {
  try {
    localStorage.removeItem(draftKey(email, scope));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(DRAFT_CHANGED));
}

/** For `useSyncExternalStore`: calls back whenever the draft may have changed, in this tab or another. */
export function subscribeToDraft(callback: () => void) {
  window.addEventListener(DRAFT_CHANGED, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(DRAFT_CHANGED, callback);
    window.removeEventListener("storage", callback);
  };
}

interface SavedWork {
  purpose?: string;
  donation?: string;
  items?: { description?: string; amount?: string; receipts?: { status?: string; fileId?: string }[] }[];
}

/**
 * True when a saved draft holds part of a request. The form saves as soon as it
 * opens, with the "about you" fields already filled from the last request, so
 * only the request itself counts: a purpose, a donation, or a line with a
 * description, an amount or a finished receipt.
 */
export function draftHasWork(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const draft = JSON.parse(raw) as SavedWork;
    if (draft.purpose?.trim() || draft.donation?.trim()) return true;
    return (draft.items ?? []).some(
      (item) => item.description?.trim() || item.amount?.trim() || item.receipts?.some((r) => r.status === "done" && r.fileId),
    );
  } catch {
    return false;
  }
}
