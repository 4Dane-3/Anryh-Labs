import Link from "next/link";
import "@/components/site/site.css";
import { SiteEffects } from "@/components/site/SiteEffects";

export const CONTACT_EMAIL = "anryhlabs@gmail.com";
export const DEMO_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("invite request: migz")}`;

export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="site">
      <SiteEffects />
      {children}
    </div>
  );
}

export function SiteHeader() {
  return (
    <header className="sb-head">
      <div className="sb-head__in">
        <Link href="/" className="sb-mark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/anryh-mark.png" alt="" width={32} height={32} className="sb-mark__img" />
          anryh labs
        </Link>
        <nav className="sb-nav" aria-label="main">
          <Link href="/#how" className="sb-nav__opt">
            how it works
          </Link>
          <Link href="/#limits" className="sb-nav__opt">
            limits
          </Link>
          <Link href="/contact">help</Link>
          <a href={DEMO_MAILTO} className="sb-cta">
            reach out
          </a>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="sb-foot">
      <div className="sb-foot__in">
        <p className="sb-foot__word" aria-hidden="true">
          anryh labs
        </p>
        <div className="sb-foot__row">
          <p>© {new Date().getFullYear()} anryh labs. ai ad automation for insurance agents.</p>
          <nav aria-label="footer">
            <Link href="/contact" className="sb-link">
              help
            </Link>
            <Link href="/privacy" className="sb-link">
              privacy
            </Link>
            <Link href="/data-deletion" className="sb-link">
              delete your data
            </Link>
            <a href={`mailto:${CONTACT_EMAIL}`} className="sb-link">
              {CONTACT_EMAIL}
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
