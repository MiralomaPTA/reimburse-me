"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * A button that posts a plain form once: pressed again before the next page
 * loads, it does nothing. The server still guards against a second post (two
 * tabs); this just keeps a double click from making one.
 */
export function PostButton({ action, busyLabel, className = "btn-secondary", children }: { action: string; busyLabel: string; className?: string; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  // Coming back to the page from the history shouldn't leave the button stuck.
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => e.persisted && setBusy(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  return (
    <form
      action={action}
      method="post"
      onSubmit={(e) => {
        if (busy) e.preventDefault();
        else setBusy(true);
      }}
    >
      <button type="submit" className={className} disabled={busy}>
        {busy ? busyLabel : children}
      </button>
    </form>
  );
}
