"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { draftHasWork, readDraft, subscribeToDraft } from "@/lib/draft";

/**
 * A link to the new-request form that says it resumes the draft when this
 * device has one in progress for `email`. The server and first paint show
 * `label`, since only the browser can see the draft.
 */
export function NewRequestLink({ email, label, draftLabel, className }: { email: string; label: string; draftLabel: string; className?: string }) {
  const hasDraft = useSyncExternalStore(
    subscribeToDraft,
    () => draftHasWork(readDraft(email)),
    () => false,
  );
  return (
    <Link href="/requests/new" className={className}>
      {hasDraft ? draftLabel : label}
    </Link>
  );
}
