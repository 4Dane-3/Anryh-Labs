import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, SiteFooter, SiteHeader, SiteShell } from "@/components/site/SiteChrome";

export const metadata: Metadata = {
  title: "delete your data · anryh labs",
  description: "how to ask anryh labs and migz ai to delete the personal information we hold about you, including data from meta.",
};

const SUBJECT = "data deletion request";
const MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(SUBJECT)}&body=${encodeURIComponent(
  "i'd like my data deleted.\n\nname:\nemail or phone number i used:\nagent i booked with (if any):\nfacebook name (if you're an agent connecting meta):\n",
)}`;

export default function DataDeletionPage() {
  return (
    <SiteShell>
      <SiteHeader />
      <main className="sb-help">
        <div>
          <h1 className="sb-h2">delete your data.</h1>
          <p className="sb-lead">
            you can ask anryh labs to delete the personal information we hold about you at any time. it works the same
            whether you are an agent using migz ai or someone who booked a call on an agent&apos;s page.
          </p>
          <div className="sb-help__facts">
            <div>
              <p className="sb-help__k">fastest way</p>
              <a href={MAILTO} className="sb-cta" style={{ marginTop: 8 }}>
                email a deletion request
              </a>
            </div>
            <div>
              <p className="sb-help__k">or write to us</p>
              <p>
                <a href={`mailto:${CONTACT_EMAIL}`} className="sb-link">
                  {CONTACT_EMAIL}
                </a>{" "}
                with the subject &ldquo;{SUBJECT}&rdquo;.
              </p>
            </div>
          </div>
        </div>

        <div className="sb-form" style={{ gap: 28 }}>
          <section>
            <h2 className="sb-label" style={{ fontSize: 20 }}>
              what happens next
            </h2>
            <ol style={{ margin: "12px 0 0", paddingLeft: 22, listStyle: "decimal", display: "grid", gap: 10, fontSize: 17, lineHeight: 1.45 }}>
              <li>send the request from the email address you used, or include the email address or phone number you booked with.</li>
              <li>if you booked a call, tell us the agent&apos;s name so we can find it.</li>
              <li>we confirm the request came from you, delete your data within 30 days, and email you when it&apos;s done.</li>
            </ol>
          </section>

          <section>
            <h2 className="sb-label" style={{ fontSize: 20 }}>
              agents who connected meta
            </h2>
            <p style={{ margin: "12px 0 0", fontSize: 17, lineHeight: 1.45 }}>
              you can remove migz ai&apos;s access yourself at any time in facebook: settings &amp; privacy → settings →
              business integrations → remove migz ai. when access is removed, we delete the meta data we received for your
              account within 30 days. you can also email us and we will do it for you.
            </p>
          </section>

          <section>
            <h2 className="sb-label" style={{ fontSize: 20 }}>
              what we delete
            </h2>
            <p style={{ margin: "12px 0 0", fontSize: 17, lineHeight: 1.45 }}>
              your profile and booking records, the intake answers you gave, ad account data we received from meta, and
              creatives we generated for you. we may keep records we are legally required to retain, such as billing
              records. the full details are in our{" "}
              <Link href="/privacy#data-deletion" className="sb-link">
                privacy policy
              </Link>
              .
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </SiteShell>
  );
}
