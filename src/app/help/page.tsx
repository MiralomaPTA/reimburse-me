import type { Metadata } from "next";
import Link from "next/link";
import { config } from "@/server/config";
import { MailtoLink } from "@/components/MailtoLink";

export const metadata: Metadata = { title: "How it works" };

const guides = [
  {
    href: "/help/teachers",
    title: "I'm a teacher",
    blurb: "Photograph your receipts, say which stipend each one comes from, sign on your phone, and see how much of each stipend is left.",
  },
  {
    href: "/help/volunteers",
    title: "I'm a volunteer or staff member",
    blurb: "Photograph your receipts, fill in a few details and sign on your phone. About five minutes, start to finish.",
  },
];

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight">How it works</h1>
      <p className="mt-3 text-lg text-neutral-700">
        Step-by-step guides to getting reimbursed by the Miraloma PTA, with pictures of every screen. Pick the one that matches you.
      </p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {guides.map((guide) => (
          <li key={guide.href}>
            <Link href={guide.href} className="card block h-full hover:border-blue-300 hover:shadow">
              <span className="block text-lg font-semibold">{guide.title}</span>
              <span className="mt-2 block text-sm text-neutral-600">{guide.blurb}</span>
              <span className="mt-4 block text-sm font-medium text-blue-700">Read the guide →</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-8 text-sm text-neutral-600">
        Questions about a payment? Email <MailtoLink email={config.apEmail} />.
      </p>
    </div>
  );
}
