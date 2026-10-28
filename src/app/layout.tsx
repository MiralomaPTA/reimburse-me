import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import logo from "@/images/miraloma-logo.png";
import { getSession } from "@/server/auth/session";
import { config } from "@/server/config";
import { MailtoLink } from "@/components/MailtoLink";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Miraloma Elementary PTA Reimbursements",
  description: "Submit a PTA reimbursement request with your receipts and sign it from your phone.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
            <Link href={session ? "/requests" : "/"} className="flex items-center gap-2.5 font-semibold tracking-tight">
              <Image src={logo} alt="Miraloma Elementary" width={40} height={40} priority className="h-10 w-10" />
              <span>
                Miraloma PTA <span className="font-normal text-neutral-500">· Reimbursements</span>
              </span>
            </Link>
            {session && (
              <nav className="flex items-center gap-4 text-sm">
                <Link href="/requests" className="text-neutral-700 hover:underline">
                  My requests
                </Link>
                <Link href="/requests/new" className="text-neutral-700 hover:underline">
                  New
                </Link>
                <form action="/api/auth/signout" method="post">
                  <button type="submit" className="text-neutral-500 hover:underline">
                    Sign out
                  </button>
                </form>
              </nav>
            )}
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
        <footer className="space-y-1 px-4 py-6 text-center text-xs text-neutral-500">
          <p>
            Made with{" "}
            <span role="img" aria-label="love">
              ❤️
            </span>{" "}
            by the{" "}
            <a href="https://www.miralomasf.com/pta" target="_blank" rel="noopener noreferrer" className="underline">
              Miraloma PTA
            </a>
            .
          </p>
          <p>
            New here?{" "}
            <Link href="/help" className="underline">
              See how it works
            </Link>
            . Questions about a payment? Email <MailtoLink email={config.apEmail} />.
          </p>
        </footer>
      </body>
    </html>
  );
}
