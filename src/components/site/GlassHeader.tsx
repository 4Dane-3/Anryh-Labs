"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { DEMO_MAILTO } from "@/lib/contact";

const LINKS = [
  { href: "/", label: "home" },
  { href: "/#how", label: "how it works" },
  { href: "/#creatives", label: "the ads" },
  { href: "/#limits", label: "limits" },
  { href: "/contact", label: "help" },
];

/** The site header: the name left, the pages in a glass pill (the current one lit), "reach out" right. */
export function GlassHeader() {
  const pathname = usePathname();
  return (
    <header className="gh-head">
      <Link href="/" className="gh-mark">
        <span className="gh-mark__glyph" aria-hidden="true" />
        anryh labs
      </Link>
      <nav className="gh-pill" aria-label="main">
        {LINKS.map(({ href, label }) => (
          <Link key={href} href={href} className={href === pathname ? "is-on" : undefined} aria-current={href === pathname ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </nav>
      <a href={DEMO_MAILTO} className="gh-btn gh-btn--white gh-head__cta">
        reach out <ArrowUpRight aria-hidden="true" />
      </a>
    </header>
  );
}
