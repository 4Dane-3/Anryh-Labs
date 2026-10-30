import { DEMO_MAILTO, SiteFooter, SiteHeader, SiteShell } from "@/components/site/SiteChrome";
import { GlassHero } from "@/components/site/GlassHero";
import { Board } from "@/components/site/Board";
import { Examples } from "@/components/site/Examples";
import { Diagnose } from "@/components/site/Diagnose";
import { SignalChain } from "@/components/site/SignalChain";
import { BrainPreview } from "@/components/site/BrainPreview";
import { SlipFile } from "@/components/site/SlipFile";
import { PhoneStory } from "@/components/site/PhoneStory";
import { Limits } from "@/components/site/Limits";

export default function Home() {
  return (
    <SiteShell>
      <SiteHeader />
      <main>
        <GlassHero />

        <div className="sb-deep">
          <section className="sb-sec" aria-labelledby="board-h">
            <h2 className="sb-h2" id="board-h" data-reveal>
              your whole campaign, live.
            </h2>
            <Board />
          </section>

          <section className="sb-sec" aria-labelledby="reads">
            <h2 className="sb-h2" id="reads" data-reveal>
              it reads the numbers, then fixes the campaign.
            </h2>
            <Diagnose />
            <p className="sb-note" style={{ marginTop: 16 }}>
              sample reads with illustrative numbers. migz ai checks results through the day, acts within your limits, and
              when the right move is to wait, it says so.
            </p>
          </section>

          <section className="sb-sec" aria-labelledby="calls">
            <h2 className="sb-h2" id="calls" data-reveal>
              calls, not clicks.
            </h2>
            <div className="calls">
              <SignalChain />
              <BrainPreview />
            </div>
          </section>

          <section className="sb-sec" aria-labelledby="slips">
            <h2 className="sb-h2" id="slips" data-reveal>
              every move comes with a reason.
            </h2>
            <SlipFile />
            <p className="sb-note" style={{ marginTop: 16 }}>
              sample activity, written the way migz ai writes it in your dashboard.
            </p>
          </section>

          <section className="sb-sec" aria-labelledby="creatives">
            <h2 className="sb-h2" id="creatives" data-reveal>
              creative is one lever. it makes the video too.
            </h2>
            <Examples />
          </section>

          <section className="sb-sec" id="how" aria-labelledby="how-h">
            <h2 className="sb-h2" id="how-h" data-reveal>
              from ad to your morning slack.
            </h2>
            <PhoneStory />
            <p className="sb-note" style={{ marginTop: 16 }}>
              the first three screens are a live booking page. the slack notification is a sample.
            </p>
          </section>

          <section className="sb-sec" id="limits" aria-labelledby="limits-h">
            <h2 className="sb-h2" id="limits-h" data-reveal>
              hard limits it can’t cross.
            </h2>
            <Limits />
          </section>

          <section className="sb-close" aria-labelledby="close-h">
            <h2 className="sb-h2" id="close-h">
              ask for an invite.
            </h2>
            <a href={DEMO_MAILTO} className="sb-cta">
              reach out
            </a>
            <p className="sb-invite">invite only. tell us your state and monthly ad budget and we’ll reply.</p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </SiteShell>
  );
}
