import type { ReturnAnswered } from "@/server/requests/stored";

/**
 * On a chair's or check signer's page for a re-signed version: who sent the
 * last version back, and the note it answers when this reader may see it
 * (see answersForChair).
 */
export function VersionNote({ version, answers, payeeName }: { version: number; answers: ReturnAnswered; payeeName: string }) {
  const note = answers.note.trim();
  return (
    <div className="mt-3 space-y-1 rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950">
      <p>
        This is version {version}. It was sent back by {answers.by}, and {payeeName} changed it and signed it again.{note ? " The note it answers:" : ""}
      </p>
      {note && <p className="whitespace-pre-wrap italic">{note}</p>}
    </div>
  );
}
