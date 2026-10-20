import { DEMO_MAILTO, SiteFooter, SiteHeader, SiteShell } from "@/components/site/SiteChrome";
import { Board } from "@/components/site/Board";
import { SignalChain } from "@/components/site/SignalChain";
import { SlipFile } from "@/components/site/SlipFile";
import { HookSwap } from "@/components/site/HookSwap";
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
                  ads that book calls,
                </span>
              </span>
              <span className="line">
                <span data-line style={line(1)}>
                  on autopilot.
                </span>
              </span>
            </h1>
            <div className="sb-hero__copy">
              <p className="sb-lead" data-load style={delay(380)}>
                migz is the ai media buyer behind your meta ads. it makes the creatives, watches the results all day,
                and moves budget toward whatever books calls.
              </p>
              <div className="sb-hero__cta" data-load style={delay(470)}>
                <a href={DEMO_MAILTO} className="sb-cta">
                  book a demo
                </a>
              </div>
            </div>
          </div>
          <div className="sb-hero__board" data-open>
            <Board />
          </div>
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
            it makes the video, then tests the hook.
          </h2>
          <HookSwap />
        </section>

        <section className="sb-sec" id="how" aria-labelledby="how-h">
          <h2 className="sb-h2" id="how-h" data-reveal>
            from ad to your morning slack.
          </h2>
          <PhoneStory />
        </section>

        <section className="sb-sec" id="limits" aria-labelledby="limits-h">
          <h2 className="sb-h2" id="limits-h" data-reveal>
            hard limits it can’t cross.
          </h2>
          <Limits />
        </section>

        <section className="sb-close" aria-labelledby="close-h">
          <h2 className="sb-h2" id="close-h">
            see it run on your market.
          </h2>
          <a href={DEMO_MAILTO} className="sb-cta">
            book a demo
          </a>
        </section>
      </main>
      <SiteFooter />
    </SiteShell>
  );
}
