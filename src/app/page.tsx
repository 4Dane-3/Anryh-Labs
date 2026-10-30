import { DEMO_MAILTO, SiteFooter, SiteHeader, SiteShell } from "@/components/site/SiteChrome";
import { Board } from "@/components/site/Board";
import { Examples } from "@/components/site/Examples";
import { Diagnose } from "@/components/site/Diagnose";
import { SignalChain } from "@/components/site/SignalChain";
import { SlipFile } from "@/components/site/SlipFile";
import { PhoneStory } from "@/components/site/PhoneStory";
import { Limits } from "@/components/site/Limits";

const line = (i: number) => ({ "--i": i }) as React.CSSProperties;
const delay = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

export default function Home() {
  return (
    <SiteShell>
      <SiteHeader />
      <main>
        <section className="sb-hero">
          <div className="sb-hero__top">
            <h1 className="sb-h1">
              <span className="line">
                <span data-line style={line(0)}>
                  life insurance ads
                </span>
              </span>
              <span className="line">
                <span data-line style={line(1)}>
                  that fix themselves.
                </span>
              </span>
            </h1>
            <div className="sb-hero__copy">
              <p className="sb-lead" data-load style={delay(380)}>
                migz runs your whole meta campaign. it reads the analytics all day, works out what is holding results
                back, and fixes it: budget, placements, creative and copy.
              </p>
              <div className="sb-hero__cta" data-load style={delay(470)}>
                <a href={DEMO_MAILTO} className="sb-cta">
                  reach out
                </a>
                <p className="sb-invite">invite only, while we onboard agents one at a time.</p>
              </div>
            </div>
          </div>
          <div className="sb-hero__board" data-open>
            <Board />
          </div>
        </section>

        <section className="sb-sec" aria-labelledby="reads">
          <h2 className="sb-h2" id="reads" data-reveal>
            it reads the numbers, then fixes the campaign.
          </h2>
          <Diagnose />
          <p className="sb-note" style={{ marginTop: 16 }}>
            sample reads with illustrative numbers. migz checks results through the day, acts within your limits, and when the right move is to wait, it says so.
          </p>
        </section>

        <section className="sb-sec" aria-labelledby="calls">
          <h2 className="sb-h2" id="calls" data-reveal>
            calls, not clicks.
          </h2>
          <SignalChain />
        </section>

        <section className="sb-sec" aria-labelledby="slips">
          <h2 className="sb-h2" id="slips" data-reveal>
            every move comes with a reason.
          </h2>
          <SlipFile />
          <p className="sb-note" style={{ marginTop: 16 }}>
            sample activity, written the way migz writes it in your dashboard.
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
      </main>
      <SiteFooter />
    </SiteShell>
  );
}
