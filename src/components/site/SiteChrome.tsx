import Link from "next/link";
import "@/components/site/site.css";
import { SiteEffects } from "@/components/site/SiteEffects";
import { GlassBackdrop } from "@/components/glass/GlassBackdrop";

import { CONTACT_EMAIL, DEMO_MAILTO } from "@/lib/contact";
import "@/components/site/glass-home.css";

export { CONTACT_EMAIL, DEMO_MAILTO };
// Every site page uses the glass header now
export { GlassHeader as SiteHeader } from "@/components/site/GlassHeader";

/** Every marketing page: frosted glass over the moving backdrop. `glass={false}` keeps the old white theme. */
export function SiteShell({ children, glass = true }: { children: React.ReactNode; glass?: boolean }) {
  return (
    <div className={glass ? "site site--glass" : "site"}>
      {glass && <GlassBackdrop />}
      <SiteEffects />
      {children}
    </div>
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
            <Link href="/terms" className="sb-link">
              terms
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
