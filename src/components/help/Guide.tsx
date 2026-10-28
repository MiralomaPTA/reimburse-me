import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Building blocks for the step-by-step guides under /help. The text lives in
 * the pages; these keep the headings, screenshots and questions looking alike.
 */

export function Guide({ title, lead, children }: { title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <article className="guide mx-auto max-w-2xl">
      <p className="mb-3 text-sm">
        <Link href="/help" className="text-neutral-500 hover:underline">
          ← How it works
        </Link>
      </p>
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-3 space-y-3 text-lg">{lead}</div>
      <div className="mt-10 space-y-12">{children}</div>
    </article>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** A phone screenshot, narrow by default; `wide` for a cropped card. */
export function Shot({ src, alt, caption, wide = false }: { src: StaticImageData; alt: string; caption?: string; wide?: boolean }) {
  return (
    <figure className={`mx-auto py-2 ${wide ? "max-w-md" : "max-w-xs"}`}>
      <Image src={src} alt={alt} sizes="(max-width: 640px) 100vw, 448px" className="w-full rounded-lg border border-neutral-200 bg-white shadow-sm" />
      {caption && <figcaption className="mt-2 text-center text-sm text-neutral-500">{caption}</figcaption>}
    </figure>
  );
}

export function Questions({ items }: { items: { q: string; a: ReactNode }[] }) {
  return (
    <dl className="space-y-4">
      {items.map(({ q, a }) => (
        <div key={q}>
          <dt className="font-semibold text-neutral-900">{q}</dt>
          <dd className="mt-1">{a}</dd>
        </div>
      ))}
    </dl>
  );
}
