import type { RequestStatus } from "@/server/adapters/types";

const styles: Record<RequestStatus, string> = {
  Submitted: "bg-blue-50 text-blue-800 border-blue-200",
  Approved: "bg-emerald-50 text-emerald-800 border-emerald-200",
  Returned: "bg-amber-50 text-amber-900 border-amber-200",
  Paid: "bg-neutral-100 text-neutral-700 border-neutral-200",
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  const style = styles[status] ?? styles.Submitted;
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${style}`}>{status}</span>;
}
