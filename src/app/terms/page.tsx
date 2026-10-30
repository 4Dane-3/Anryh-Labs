import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, SiteFooter, SiteHeader, SiteShell } from "@/components/site/SiteChrome";

export const metadata: Metadata = {
  title: "terms of service · anryh labs",
  description: "the terms for using anryh labs and the migz ai ad automation platform, for agents and for people who book calls.",
};

const EFFECTIVE = "october 21, 2026";

const SECTIONS = [
  ["agreement", "the agreement"],
  ["who-can-use", "who can use migz ai"],
  ["what-we-provide", "what we provide"],
  ["your-responsibilities", "your responsibilities"],
  ["ai-and-automation", "ai and automation"],
  ["meta-and-third-parties", "meta and third parties"],
  ["ad-funds-and-fees", "ad funds and fees"],
  ["no-guarantees", "no guarantees"],
  ["prospects", "prospects and booked calls"],
  ["content", "content and ownership"],
  ["acceptable-use", "acceptable use"],
  ["privacy", "privacy"],
  ["disclaimers", "disclaimers"],
  ["liability", "limit of liability"],
  ["indemnity", "indemnity"],
  ["termination", "suspension and ending"],
  ["changes", "changes to these terms"],
  ["law", "governing law"],
  ["contact", "contact us"],
] as const;

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 pt-4 text-xl font-semibold tracking-tight text-slate-900">
      {children}
    </h2>
  );
}

export default function TermsPage() {
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
              <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">terms of service</h1>
              <p className="text-sm text-slate-500">effective {EFFECTIVE}</p>
              <p>
                these terms are the agreement between you and anryh labs about using our website and the migz ai platform.
                please read them. questions go to {email}.
              </p>
            </header>

            <H2 id="agreement">1. the agreement</H2>
            <p>
              anryh labs (&ldquo;we&rdquo;, &ldquo;us&rdquo;) runs <span className="font-medium text-slate-900">migz ai</span>,
              an ai ad automation platform for independent life insurance agents. by using migz ai, an agent&apos;s booking
              page or this website, you agree to these terms and to our{" "}
              <Link href="/privacy" className="font-medium text-slate-900 underline">
                privacy policy
              </Link>
              . if you don&apos;t agree, don&apos;t use them. if you use migz ai for a business, you confirm you can bind
              that business to these terms. an order form or written agreement with us can add to or replace parts of
              these terms for you; if they conflict, the written agreement wins.
            </p>

            <H2 id="who-can-use">2. who can use migz ai</H2>
            <p>
              migz ai is invite only. to use it as an agent you must be at least 18, hold a current life insurance license
              in each state where you advertise, and have been invited by us. you must give us accurate information,
              including your licensed states, and keep your login private. you are responsible for what happens under
              your account. people who book calls on an agent&apos;s page don&apos;t need an account.
            </p>

            <H2 id="what-we-provide">3. what we provide</H2>
            <p>with your permission, migz ai:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>creates and manages advertising campaigns for you on meta (facebook and instagram) through your ad account.</li>
              <li>writes ad copy and generates video and image creatives, and can launch creatives you upload.</li>
              <li>reviews results, adjusts budgets, placements and creatives, and runs tests.</li>
              <li>hosts your public booking page and calendar, and sends you booking alerts and summaries.</li>
              <li>shows you what it did and why in your dashboard.</li>
            </ul>
            <p>
              we may add, change or remove features. migz ai is invite only and may change as we learn. we aim to keep it
              available but do not promise it will be uninterrupted or error free.
            </p>

            <H2 id="your-responsibilities">4. your responsibilities</H2>
            <p>you are the advertiser, and the ads run under your name and your ad account. you agree that:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>you are licensed and in good standing for everything you advertise, and you only advertise in states where you are licensed.</li>
              <li>you will follow the insurance advertising, privacy, telemarketing, texting and consumer protection laws that apply to you, and meta&apos;s advertising policies, including its rules for financial products and services.</li>
              <li>you will review what migz ai proposes or does, and tell us promptly if something is wrong. in ask-first mode, you decide what is approved. in automatic mode, you accept that migz ai acts within the limits you set.</li>
              <li>you will keep enough funds in your ad balance, and tell us if you want ads paused.</li>
              <li>you have the rights to any photos, videos, testimonials, license details or other material you give us, and testimonials are real and used with permission.</li>
              <li>you are responsible for how you follow up with people who book, and for the advice you give them.</li>
            </ul>

            <H2 id="ai-and-automation">5. ai and automation</H2>
            <p>
              migz ai uses artificial intelligence, including models from anthropic, to analyze results and write ad copy,
              and image and video generation tools from third parties to make creatives. ai can be wrong. we build safety
              limits into migz ai (such as your daily budget, limits on how fast budgets change, copy rules for insurance
              ads, and a pause switch), but they do not catch everything. ai output is not legal, compliance, tax or
              financial advice. you are responsible for the ads that run under your name, including generated ones. you
              can pause ads or turn migz ai off at any time in your dashboard.
            </p>

            <H2 id="meta-and-third-parties">6. meta and third parties</H2>
            <p>
              migz ai works through services we don&apos;t control: meta, stripe, slack, our ai and creative providers, and
              our hosting and database providers. their terms apply to your use of them, including{" "}
              <span className="font-medium text-slate-900">meta&apos;s terms and advertising policies</span>. meta decides
              whether ads are approved, how they deliver, and may restrict or disable ad accounts, and we can&apos;t
              guarantee otherwise. you can remove migz ai&apos;s access to your meta account at any time in your facebook
              settings. if a third-party service is unavailable or changes, parts of migz ai may stop working.
            </p>

            <H2 id="ad-funds-and-fees">7. ad funds and fees</H2>
            <ul className="list-disc space-y-2 pl-5">
              <li>ad spend is paid from the balance you add. migz ai will not spend more than your daily budget, and ads are paused if your balance cannot cover a day of spend.</li>
              <li>money spent on ads is paid to meta and cannot be refunded by us once spent.</li>
              <li>our fees, if any, are the ones we agree with you in writing. we will not charge fees you have not agreed to.</li>
              <li>you can ask for your unused balance back by email after you stop using migz ai. we return it less amounts already spent or owed to us, and subject to our payment processor and the law.</li>
              <li>you are responsible for your own taxes. card payments are handled by stripe; we don&apos;t store card numbers.</li>
            </ul>

            <H2 id="no-guarantees">8. no guarantees</H2>
            <p>
              advertising results depend on many things we don&apos;t control, including meta&apos;s delivery, your market,
              your follow-up and how people respond. we do not guarantee any number of clicks, booked calls, policies sold,
              revenue, cost per booked call or return on ad spend. the sample numbers on our website are examples, not
              promises. nothing we provide is insurance, financial or legal advice, and we do not sell insurance.
            </p>

            <H2 id="prospects">9. prospects and booked calls</H2>
            <p>
              when someone books a call on an agent&apos;s page, the call is between that person and the agent. anryh
              labs hosts the page and the booking, but we are not a party to what the agent offers or says, and we don&apos;t
              guarantee that an agent will keep an appointment or that anyone will qualify for coverage. prospects who
              book agree to be contacted about their booking, and to the consent shown on the page when they book. the
              agent is responsible for any later calls, texts or emails and for honoring requests to stop. optional prep
              answers are shared with the agent they booked with, as described in our privacy policy.
            </p>

            <H2 id="content">10. content and ownership</H2>
            <p>
              you keep ownership of what you give us. you let us host, copy, adapt and display it as needed to run migz ai
              for you, for example to turn your video into an ad, show testimonials on your page, or share it with meta.
              creatives migz ai makes for you may be used in your own advertising while you use migz ai, subject to the
              terms of the tools that generated them. anryh labs and its suppliers own migz ai, its software, designs and
              our branding. you may not copy, resell or reverse engineer migz ai. if you send us feedback, we may use it
              without owing you anything.
            </p>

            <H2 id="acceptable-use">11. acceptable use</H2>
            <p>you agree not to use migz ai or this website to:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>advertise anything unlawful, misleading or unsafe, or make false or deceptive claims about insurance, including guarantees of approval, savings or rates.</li>
              <li>target or discriminate against people in ways meta or the law prohibits.</li>
              <li>upload content you don&apos;t have the right to use, or that is harmful, harassing or infringing.</li>
              <li>collect people&apos;s information without permission, spam anyone, or break telemarketing or privacy laws.</li>
              <li>probe, disrupt, overload or get around the security or limits of migz ai, or access accounts that are not yours.</li>
              <li>use migz ai to build a competing product.</li>
            </ul>

            <H2 id="privacy">12. privacy</H2>
            <p>
              our{" "}
              <Link href="/privacy" className="font-medium text-slate-900 underline">
                privacy policy
              </Link>{" "}
              explains what we collect and how we use it, including data from meta. you can ask us to delete your data at
              any time on our{" "}
              <Link href="/data-deletion" className="font-medium text-slate-900 underline">
                data deletion page
              </Link>
              .
            </p>

            <H2 id="disclaimers">13. disclaimers</H2>
            <p>
              migz ai and this website are provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. to the extent the law
              allows, we disclaim all warranties, express or implied, including merchantability, fitness for a
              particular purpose, accuracy and non-infringement. we do not promise that ads will be approved or delivered,
              that ai output is correct or compliant, or that the service will be free of errors or interruptions.
            </p>

            <H2 id="liability">14. limit of liability</H2>
            <p>
              to the extent the law allows, anryh labs and the people who work for us will not be liable for indirect,
              incidental, special, consequential or punitive damages, or for lost profits, lost sales, lost data or
              loss of goodwill, even if we were told it could happen. our total liability for any claim relating to
              migz ai or these terms is limited to the greater of the fees you paid us in the 3 months before the claim and
              $100. this does not apply to amounts you owe, and nothing in these terms limits liability that cannot be
              limited by law. money spent on ads is paid to meta and is not a fee to us.
            </p>

            <H2 id="indemnity">15. indemnity</H2>
            <p>
              you agree to defend and reimburse anryh labs against claims, losses and costs (including reasonable legal
              fees) that come from your ads, your content, your insurance activities, your follow-up with prospects, or
              your breach of these terms or the law. we will tell you about a claim promptly and let you handle it, as
              far as the law allows.
            </p>

            <H2 id="termination">16. suspension and ending</H2>
            <p>
              you can stop using migz ai at any time by turning it off in your dashboard or emailing us. we may suspend or
              end your access, and pause your ads, if you break these terms or the law, if meta or a regulator requires
              it, if your balance can&apos;t cover spend, or to protect people or the service. when your access ends,
              we stop managing your campaigns, and you can ask us to delete your data. sections that by their nature
              should continue (such as ownership, disclaimers, liability, indemnity and governing law) continue after
              these terms end.
            </p>

            <H2 id="changes">17. changes to these terms</H2>
            <p>
              we may update these terms as migz ai or the law changes. we will update the effective date above, and for
              significant changes, notify agents by email or in their dashboard. if you keep using migz ai after a change
              takes effect, you accept the new terms.
            </p>

            <H2 id="law">18. governing law</H2>
            <p>
              these terms are governed by the laws of the state in which anryh labs is organized, without regard to its
              conflict of laws rules. disputes will be brought in the state or federal courts located there, and you and
              we consent to those courts. before filing a claim, you agree to email us and give us 30 days to try to
              resolve it.
            </p>

            <H2 id="contact">19. contact us</H2>
            <p>anryh labs · {email}</p>
          </article>
        </div>
      </main>
      <SiteFooter />
    </SiteShell>
  );
}
