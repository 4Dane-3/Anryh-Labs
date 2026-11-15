// The words on each ad group's landing page. The headline and subhead come from the ad group itself, so the page
// says what the ad said. Everything else is written from the roofer's own facts (their special, certification,
// warranty, license and area) and never claims more: no free roof, no insurance outcome, no prices, no financing.

import type { LandingKey } from "@/lib/landing/groups";

export type LandingFacts = {
  company: string;
  city: string | null;
  area: string | null; // "within 15 miles of Bothell, WA"
  offer: "inspection" | "quote";
  special: string | null;
  certification: string | null;
  warranty: string | null;
  license: string | null;
  emergencies: boolean;
};

export type LandingCopy = {
  title: string;
  subhead: string;
  intro: string;
  cta: string;
  steps: { title: string; body: string }[];
  why: string[];
  faq: { q: string; a: string }[];
  disclaimer: string;
};

const INTRO: Record<LandingKey, (f: LandingFacts) => string> = {
  replacement: (f) => `Thinking about a new roof? ${f.company} looks at the whole roof first, tells you honestly whether it needs replacing, and gives you a clear, written price before any work starts.`,
  repair: (f) => `A leak, missing shingles or a sagging spot? ${f.company} finds what's causing it and tells you what it takes to fix, with photos, before any work starts.`,
  storm: (f) => `After hail or high winds, damage isn't always visible from the ground. ${f.company} checks the roof and photographs what we find, so you know where you stand.`,
  inspection: (f) => `Buying, selling, or just want to know how your roof is holding up? ${f.company} inspects it top to bottom and walks you through what we find, with photos.`,
  gutters: (f) => `Overflowing, sagging or leaking gutters? ${f.company} installs seamless gutters and guards, measured for your home.`,
  siding: (f) => `Cracked, faded or loose siding? ${f.company} replaces siding with a local crew and gives you a clear, written price first.`,
};

const FAQ: Record<LandingKey, (f: LandingFacts, offer: string) => { q: string; a: string }[]> = {
  replacement: (f, offer) => [
    { q: "How do I know if I need a new roof or just a repair?", a: `That's what the ${offer} is for. We look at the shingles, flashing, vents and decking and tell you honestly whether a repair will do.` },
    { q: "How long does a replacement take?", a: "It depends on the size of the roof and the weather. We'll give you a timeline at the inspection." },
  ],
  repair: (f, offer) => [
    { q: "Can you find where the leak is coming from?", a: "Leaks often show up far from where the water gets in. We trace it back and show you photos of the cause." },
    ...(f.emergencies ? [{ q: "Do you handle urgent leaks?", a: "Yes. Book the earliest time and tell us it's urgent." }] : []),
    { q: `Is the ${offer} really free?`, a: `Yes. You get the ${offer} and our findings with no obligation to go ahead.` },
  ],
  storm: (_f, offer) => [
    { q: "Will my insurance cover the damage?", a: "We can't promise that: it's up to your insurer and your policy. We document what we find with photos so you have a clear record." },
    { q: "How soon after a storm should I book?", a: `As soon as you can. Small damage can turn into leaks. The ${offer} costs nothing.` },
  ],
  inspection: (_f, offer) => [
    { q: "What do you check?", a: "Shingles, flashing, vents, gutters, signs of leaks and the attic if you'd like. You get photos of everything we find." },
    { q: `Is the ${offer} really free?`, a: `Yes, with no obligation to go ahead with anything.` },
  ],
  gutters: () => [
    { q: "What are seamless gutters?", a: "Gutters made to the exact length of your roofline on site, so there are fewer joints to leak." },
    { q: "Do you install gutter guards?", a: "Yes. We can talk through the options when we measure." },
  ],
  siding: () => [
    { q: "Can you match my existing siding?", a: "We'll look at what you have and show you options at the visit." },
    { q: "How long does it take?", a: "It depends on the size of the home and the weather. We'll give you a timeline when we quote." },
  ],
};

/** "License #123" from a bare number; a license they wrote out ("WA Lic #ABC123") as they wrote it. */
export const licenseText = (l: string) => (/lic|#/i.test(l) ? l.trim() : `License #${l.trim()}`);

/** A landing page's words, from the ad group's headline and description and the roofer's facts. */
export function landingCopy(key: LandingKey, ad: { headline: string; description: string }, f: LandingFacts): LandingCopy {
  const offer = f.offer === "quote" ? "free quote" : "free roof inspection";
  const Offer = f.offer === "quote" ? "Free Quote" : "Free Roof Inspection";
  const why = [
    f.certification ? `${f.certification}` : null,
    f.warranty ? `${f.warranty}` : null,
    f.license ? licenseText(f.license) : "Licensed and insured",
    f.area ? `Serving homes ${f.area}` : f.city ? `Local to ${f.city}` : "A local crew",
    "Photos of everything we find",
    "A clear, written price before any work",
  ].filter((x): x is string => !!x);
  return {
    title: ad.headline,
    subhead: ad.description,
    intro: INTRO[key](f),
    cta: "Get my free quote",
    steps: [
      { title: "Request your quote", body: "Tell us what's going on with the roof. It takes under a minute." },
      { title: "Emma calls you right away", body: "Emma is our AI assistant. She asks a few quick questions about your roof so your quote fits, and can set up the visit." },
      { title: f.offer === "quote" ? "We come out and measure" : "We inspect the roof", body: "You don't need to climb anything. We look at the whole roof and the problem you told us about." },
      { title: "You get straight answers", body: "What we found, with photos, and a clear price. You decide what, if anything, to do next." },
    ],
    why,
    faq: [
      { q: "Who will call me?", a: "Emma, our AI assistant, calls right after you send your request (between 8am and 8pm your time; later requests are called the next morning). She asks a few questions about your roof, and our team takes it from there." },
      ...FAQ[key](f, offer),
    ],
    disclaimer: `${f.company}${f.license ? ` (${licenseText(f.license)})` : ""} offers a ${Offer.toLowerCase()} to homeowners in its service area. An inspection or quote is not a promise of any repair, price or insurance outcome.`,
  };
}
