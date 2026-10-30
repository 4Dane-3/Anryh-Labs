import Image from "next/image";
import { ExampleVideo } from "./ExampleVideo";

type Ad = { src: string; w: number; h: number; alt: string };
const shape = (a: Ad) => ({ "--a": a.w / a.h }) as React.CSSProperties;

// What most agents run: loud, cluttered, a promise in the headline
const TYPICAL: Ad[] = [
  { src: "/examples/typical-1.webp", w: 600, h: 600, alt: "A yellow ad in red and black capitals: no 2 year wait, whole life insurance, up to $50,000" },
  { src: "/examples/typical-2.webp", w: 338, h: 600, alt: "A veterans whole life ad in blue capitals with three age buttons" },
  { src: "/examples/typical-3.webp", w: 600, h: 600, alt: "A dark ad with letters and a dog tag: he wrote her letters, now it's her turn to be protected" },
  { src: "/examples/typical-4.webp", w: 600, h: 600, alt: "A red starburst ad: no waiting period, act now, select your age" },
];

// What Migz made for an agent's live campaign: a real photo, one line, one next step
const MIGZ: Ad[] = [
  { src: "/examples/migz-1.webp", w: 720, h: 900, alt: "A couple laughing over coffee: rates locked in for life" },
  { src: "/examples/migz-2.webp", w: 720, h: 900, alt: "A grandmother baking with her granddaughter: as low as $50 a month to protect your family" },
  { src: "/examples/migz-3.webp", w: 720, h: 900, alt: "Three generations fishing from a dock: leave a legacy, coverage up to $1 million" },
  { src: "/examples/migz-4.webp", w: 720, h: 900, alt: "A couple walking a dog on an autumn street: a bill that'll never increase" },
];

function Item({ ad, sizes }: { ad: Ad; sizes: string }) {
  return (
    <div className="ex__item" style={shape(ad)}>
      <Image src={ad.src} alt={ad.alt} width={ad.w} height={ad.h} sizes={sizes} />
    </div>
  );
}

/** Typical life insurance ads next to the ones Migz makes, split by a rule. */
export function Examples() {
  return (
    <div className="ex">
      <div>
        <p className="ex__label">
          what most life insurance ads look like.
          <span>per meta ad library</span>
        </p>
        <div className="ex__grid" role="group" aria-label="Typical life insurance ads">
          <div className="ex__row">
            <Item ad={TYPICAL[0]} sizes="(max-width: 860px) 60vw, 25vw" />
            <ExampleVideo silent src="/examples/typical-video.mp4" poster="/examples/typical-video.jpg" w={540} h={534} label="Video ad: a cluttered no 2 year wait whole life ad with icons, a list and a clip of a woman holding a letter" />
          </div>
          <div className="ex__row">
            {TYPICAL.slice(1).map((a) => (
              <Item key={a.src} ad={a} sizes="(max-width: 860px) 60vw, 25vw" />
            ))}
          </div>
        </div>
      </div>
      <div className="ex__rule" aria-hidden="true" />
      <div>
        <p className="ex__label">
          what migz makes.
          <span>video and image ads, live for one agent</span>
        </p>
        <div className="ex__grid" role="group" aria-label="Ads made by Migz">
          <div className="ex__row">
            <ExampleVideo src="/examples/migz-video-3.mp4" poster="/examples/migz-video-3.jpg" w={1080} h={1350} label="Video ad: an agent talking to the camera about whole life" />
            <ExampleVideo src="/examples/migz-video-2.mp4" poster="/examples/migz-video-2.jpg" w={540} h={960} label="Video ad: a podcast conversation about leaving a bill behind" />
            <ExampleVideo src="/examples/migz-video-1.mp4" poster="/examples/migz-video-1.jpg" w={540} h={960} label="Video ad: a family dinner on a porch at sunset" />
          </div>
          <div className="ex__row">
            {MIGZ.map((a) => (
              <Item key={a.src} ad={a} sizes="(max-width: 860px) 50vw, 25vw" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
