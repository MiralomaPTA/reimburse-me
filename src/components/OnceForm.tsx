"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A plain form that posts once: tapped again before the next page loads, it
 * does nothing, and its button says it's working. Like PostButton, but with
 * fields. Only the button is disabled, never the fields, so their values
 * still go with the post. Without scripts it's an ordinary form, and the
 * server still refuses a second step (two tabs).
 */
export function OnceForm({
  action,
  label,
  busyLabel,
  buttonClassName = "btn-primary",
  className,
  children,
}: {
  action: string;
  label: string;
  busyLabel: string;
  buttonClassName?: string;
  className?: string;
  children?: ReactNode;
}) {
  const sent = useRef(false);
  const [busy, setBusy] = useState(false);
  // Coming back to the page from the history shouldn't leave it stuck.
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      sent.current = false;
      setBusy(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  return (
    <form
      action={action}
      method="post"
      className={className}
      onSubmit={(e) => {
        if (sent.current) {
          e.preventDefault();
          return;
        }
        sent.current = true;
        setBusy(true);
      }}
    >
      {children}
      <button type="submit" className={buttonClassName} disabled={busy}>
        {busy ? busyLabel : label}
      </button>
    </form>
  );
}
