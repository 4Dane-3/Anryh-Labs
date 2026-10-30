import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, SiteFooter, SiteHeader, SiteShell } from "@/components/site/SiteChrome";

export const metadata: Metadata = {
  title: "privacy policy · anryh labs",
  description:
    "how anryh labs and the migz platform collect, use, share and delete data, including data from meta and from people who book calls with our agents.",
};

const EFFECTIVE = "october 29, 2026";

const SECTIONS = [
  ["who-we-are", "who we are"],
  ["who-this-covers", "who this policy covers"],
  ["what-we-collect", "information we collect"],
  ["how-we-use", "how we use information"],
  ["sharing", "who we share it with"],
  ["meta-data", "data from meta"],
  ["cookies", "cookies"],
  ["retention", "how long we keep it"],
  ["security", "security"],
  ["data-deletion", "your rights and deleting your data"],
  ["children", "children"],
  ["changes", "changes to this policy"],
  ["contact", "contact us"],
] as const;

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 pt-4 text-xl font-semibold tracking-tight text-slate-900">
      {children}
    </h2>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li>
      <span className="font-medium text-slate-900">{label}:</span> {children}
    </li>
  );
}

export default function PrivacyPage() {
  const email = (
    <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-700 hover:underline">
      {CONTACT_EMAIL}
    </a>
  );

  return (
    <SiteShell>
      <SiteHeader />
      <main className="sb-doc mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:py-20">
        <div className="grid gap-12 lg:grid-cols-[220px_1fr]">
          <aside className="hidden lg:block">
            <nav className="sticky top-24 space-y-1.5 text-sm" aria-label="on this page">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">on this page</p>
              {SECTIONS.map(([id, label]) => (
                <a key={id} href={`#${id}`} className="block text-slate-500 transition-colors hover:text-slate-900">
                  {label}
                </a>
              ))}
            </nav>
          </aside>

          <article className="max-w-2xl space-y-5 leading-relaxed text-slate-600">
            <header className="space-y-3 pb-4">
              <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">privacy policy</h1>
              <p className="text-sm text-slate-500">effective {EFFECTIVE}</p>
              <p>
                this policy explains how anryh labs collects, uses, shares and deletes information through our website
                and the migz platform. if you have a question, or want your data deleted, email {email}.
              </p>
            </header>

            <H2 id="who-we-are">1. who we are</H2>
            <p>
              anryh labs (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is an ai ad automation agency. we run{" "}
              <span className="font-medium text-slate-900">migz</span>, a platform that independent life insurance
              agents use to run their advertising. with an agent&apos;s permission, migz creates and manages ad campaigns
              on meta (facebook and instagram) on their behalf, generates ad creatives, hosts the agent&apos;s booking page
              and calendar, and reports results back to the agent. anryh labs is not an insurance company or agency and
              does not sell insurance.
            </p>

            <H2 id="who-this-covers">2. who this policy covers</H2>
            <ul className="list-disc space-y-2 pl-5">
              <Item label="agents">insurance agents who use migz and their dashboard.</Item>
              <Item label="prospects">people who visit an agent&apos;s booking page, book a call or answer prep questions.</Item>
              <Item label="visitors">anyone browsing this website or contacting us.</Item>
            </ul>

            <H2 id="what-we-collect">3. information we collect</H2>
            <p>from agents:</p>
            <ul className="list-disc space-y-2 pl-5">
              <Item label="account and profile">name, email, login credentials, photo, bio, license number, licensed states, timezone, availability and slack member id.</Item>
              <Item label="content">testimonials, photos and videos agents upload, and the questions they choose to ask prospects.</Item>
              <Item label="billing">ad budget, balance and transaction history. card payments are handled by stripe; we do not store card numbers.</Item>
            </ul>
            <p>from meta&apos;s platform, through the meta marketing api, for agents who authorize it:</p>
            <ul className="list-disc space-y-2 pl-5">
              <Item label="ad accounts and pages">ad account ids, facebook page and instagram account ids used to run the agent&apos;s ads.</Item>
              <Item label="campaign data">campaign, ad set and ad settings, budgets, delivery status and creative assets.</Item>
              <Item label="performance data">aggregated results such as spend, impressions, clicks and conversion counts.</Item>
            </ul>
            <p>from prospects, on an agent&apos;s booking page:</p>
            <ul className="list-disc space-y-2 pl-5">
              <Item label="booking details">name, email, phone number, the appointment time and a record of your consent to be contacted.</Item>
              <Item label="optional prep answers">answers you choose to give, which may include date of birth, gender, marital status, nicotine use, existing coverage, budget, coverage needs and notes for the agent. every question is optional.</Item>
              <Item label="ad attribution">if you arrived from an ad: campaign tags in the link (such as utm parameters and meta&apos;s click id), meta&apos;s browser cookies if present (_fbp, _fbc), and your ip address and browser type when the page opens, when you pick a time and when you book.</Item>
            </ul>
            <p>from visitors: the details you include if you email us.</p>

            <H2 id="how-we-use">4. how we use information</H2>
            <ul className="list-disc space-y-2 pl-5">
              <li>to run and improve agents&apos; ad campaigns: migz analyzes performance data, adjusts budgets, placements and ads, and generates new creatives.</li>
              <li>to let prospects book calls with an agent, confirm appointments and give the agent the prep answers before the call.</li>
              <li>to notify agents about new bookings and send a daily summary, including through slack.</li>
              <li>to measure which ads lead to booked calls, including by reporting a booking to meta as a conversion (see below).</li>
              <li>to manage agents&apos; ad funds and billing, provide support, keep the service secure and meet legal obligations.</li>
            </ul>
            <p>
              we do not sell personal information, and we do not use prospects&apos; information for anything other than
              providing the service to the agent they booked with.
            </p>

            <H2 id="sharing">5. who we share it with</H2>
            <ul className="list-disc space-y-2 pl-5">
              <Item label="the agent you booked with">receives your booking details and any prep answers you provided.</Item>
              <Item label="meta">receives the agent&apos;s ads and settings, and, when you book, a conversion event containing your email and phone number in hashed (scrambled) form plus the attribution details above. if you arrived from one of our ads, meta is also told when the booking page opens and when you pick a time, with the ad&apos;s click id, your ip address and browser type, and no name or contact details. visits that didn&apos;t come from an ad aren&apos;t reported. prep answers are never sent to meta.</Item>
              <Item label="supabase">stores our database, files and logins.</Item>
              <Item label="vercel">hosts our website and app.</Item>
              <Item label="slack">delivers booking notifications and summaries to the agent.</Item>
              <Item label="anthropic (claude)">powers migz&apos;s decisions. it receives ad performance data, campaign settings and ad copy, not prospects&apos; contact details or prep answers.</Item>
              <Item label="higgsfield">generates ad videos and images from creative descriptions. it does not receive personal information.</Item>
              <Item label="stripe">processes payments when agents add ad funds.</Item>
            </ul>
            <p>
              these providers process data only to deliver their service to us. we may also disclose information when
              required by law, to protect our rights or users&apos; safety, or as part of a merger or sale of our business.
            </p>

            <H2 id="meta-data">6. data from meta</H2>
            <p>
              we access meta&apos;s platform only with an agent&apos;s authorization and use the data we receive only to provide
              migz to that agent: running their campaigns, reporting their results and improving their ads. we follow
              meta&apos;s platform terms. we do not sell meta platform data, use it to build profiles of individual people,
              or share it with anyone other than the service providers listed above. when an agent stops using migz,
              removes our access, or asks us to, we delete the meta data we hold for them as described below.
            </p>

            <H2 id="cookies">7. cookies</H2>
            <p>
              this website does not use advertising or analytics trackers. the agent dashboard uses essential cookies to
              keep you signed in. on booking pages, we read meta&apos;s own cookies if they are already in your browser,
              only to attribute a booking to the ad that led to it.
            </p>

            <H2 id="retention">8. how long we keep it</H2>
            <ul className="list-disc space-y-2 pl-5">
              <li>agent accounts and meta data: while the account is active, then deleted within 30 days of closing the account or revoking access.</li>
              <li>prospect bookings and prep answers: for as long as the agent uses migz, unless you ask us to delete them sooner.</li>
              <li>billing records: as long as the law requires.</li>
              <li>emails to us: as long as needed to answer you.</li>
            </ul>

            <H2 id="security">9. security</H2>
            <p>
              data is encrypted in transit (https/tls) and at rest by our providers. access to agent and prospect data
              is restricted to our servers and the agent it belongs to, and contact details sent to meta are hashed
              first. no system is perfectly secure, but we work to protect your information and will notify affected
              users of a breach as required by law.
            </p>

            <section id="data-deletion" className="scroll-mt-24 space-y-3 rounded-2xl bg-slate-50 p-6 ring-1 ring-slate-200">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">10. your rights and deleting your data</h2>
              <p>
                you can ask to see, correct or delete the personal information we hold about you, whether you are an
                agent or a prospect who booked a call. to request deletion:
              </p>
              <ol className="list-decimal space-y-2 pl-5">
                <li>
                  email {email} with the subject <span className="font-medium text-slate-900">&ldquo;data deletion request&rdquo;</span>.
                </li>
                <li>include the email address or phone number you used, and the agent&apos;s name if you booked a call.</li>
                <li>we will confirm the request came from you, delete your data within 30 days, and email you when it&apos;s done.</li>
              </ol>
              <p>
                agents can also remove migz&apos;s access to their meta account at any time in their facebook settings
                (settings &amp; privacy → business integrations). when access is removed, we delete the meta data we
                received for that agent within 30 days. we may keep records we are legally required to retain, such as
                billing records.
              </p>
              <p>
                you can also use our{" "}
                <Link href="/data-deletion" className="font-medium text-slate-900 underline">
                  data deletion page
                </Link>
                , which has a ready-to-send request.
              </p>
            </section>

            <H2 id="children">11. children</H2>
            <p>migz and our booking pages are for adults. we do not knowingly collect information from anyone under 18.</p>

            <H2 id="changes">12. changes to this policy</H2>
            <p>
              we may update this policy as our product or the law changes. we will update the effective date above, and
              for significant changes, notify agents by email or in their dashboard.
            </p>

            <H2 id="contact">13. contact us</H2>
            <p>anryh labs · {email}</p>
          </article>
        </div>
      </main>
      <SiteFooter />
    </SiteShell>
  );
}
