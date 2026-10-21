import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, SiteFooter, SiteHeader, SiteShell } from "@/components/site/SiteChrome";
import { ContactForm } from "@/components/site/ContactForm";

export const metadata: Metadata = {
  title: "help · anryh labs",
  description: "questions about migz, your ads or your account? email anryh labs.",
};

export default function ContactPage() {
  return (
    <SiteShell>
      <SiteHeader />
      <main className="sb-help">
        <div>
          <h1 className="sb-h2">how can we help?</h1>
          <p className="sb-lead">
            questions about migz, your ads, billing or your data. we usually reply within one business day.
          </p>
          <div className="sb-help__facts">
            <div>
              <p className="sb-help__k">email us directly</p>
              <a href={`mailto:${CONTACT_EMAIL}`} className="sb-link">
                {CONTACT_EMAIL}
              </a>
            </div>
            <div>
              <p className="sb-help__k">delete your data</p>
              <p>
                see{" "}
                <Link href="/privacy#data-deletion" className="sb-link">
                  how to request deletion
                </Link>{" "}
                in our privacy policy.
              </p>
            </div>
          </div>
        </div>
        <ContactForm />
      </main>
      <SiteFooter />
    </SiteShell>
  );
}
