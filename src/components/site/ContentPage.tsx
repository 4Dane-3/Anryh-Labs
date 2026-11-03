import Link from "next/link";
import { DEMO_MAILTO, SiteFooter, SiteHeader, SiteShell } from "@/components/site/SiteChrome";
import "@/components/site/content.css";

/** The shell for the pricing, coverage and blog pages: glass header and footer around a light reading sheet. */
export function ContentPage({ children }: { children: React.ReactNode }) {
  return (
    <SiteShell>
      <SiteHeader />
      <main className="sb-doc mx-auto max-w-5xl px-4 py-12 sm:px-8 lg:py-16">
        <article className="space-y-5 leading-relaxed text-slate-600">{children}</article>
      </main>
      <SiteFooter />
    </SiteShell>
  );
}

export function Crumbs({ items }: { items: { name: string; href?: string }[] }) {
  return (
    <nav aria-label="breadcrumb" className="text-sm text-slate-500">
      {items.map((it, i) => (
        <span key={it.name}>
          {i > 0 && " / "}
          {it.href ? <Link href={it.href}>{it.name}</Link> : it.name}
        </span>
      ))}
    </nav>
  );
}

export const H1 = ({ children }: { children: React.ReactNode }) => (
  <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">{children}</h1>
);

export const H2 = ({ children, id }: { children: React.ReactNode; id?: string }) => (
  <h2 id={id} className="scroll-mt-24 pt-6 text-2xl font-semibold tracking-tight text-slate-900">
    {children}
  </h2>
);

export const Bullets = ({ items }: { items: string[] }) => (
  <ul className="list-disc space-y-2 pl-5">
    {items.map((x) => (
      <li key={x}>{x}</li>
    ))}
  </ul>
);

/** The closing line of a page: ask for an invite. */
export function InviteLine() {
  return (
    <p className="pt-6">
      migz ai is invite only. <a href={DEMO_MAILTO}>ask for an invite</a>: tell us your state and your budget and we&apos;ll reply, or see the{" "}
      <Link href="/pricing">pricing</Link>.
    </p>
  );
}
