// Competitor research: the shapes every step reads and writes. A field a platform doesn't give is null, never guessed.

export type MarketKind = "local" | "benchmark";
/** Where we look: the roofer's own service area, and an English-speaking EU market where Meta and Google show real reach. */
export type Market = { key: string; kind: MarketKind; label: string; query: string; country: string; region: string };

export type Advertiser = {
  market: string;
  name: string;
  domain: string | null;
  website: string | null;
  rating: number | null;
  reviews: number | null;
  phone: string | null;
  address: string | null;
  placeUrl: string | null;
  facebookUrls: string[];
  googleAds: number;
  metaAds: number;
};

export type Platform = "google" | "meta";
export type OfferType = "price" | "money off" | "free" | "guarantee" | "speed";

export type CompAd = {
  id: string; // "<platform>-<native id>"
  market: string;
  platform: Platform;
  advertiser: string;
  domain: string | null;
  format: "text" | "image" | "video" | "carousel" | null;
  headline: string | null;
  body: string | null;
  description: string | null;
  cta: string | null;
  displayUrl: string | null;
  landingUrl: string | null;
  media: { image: string | null; video: string | null; thumbnail: string | null };
  startDate: string | null;
  lastSeen: string | null;
  daysRunning: number | null;
  active: boolean | null;
  copies: number | null; // Meta's collation count
  impressionsRank: number | null; // 1-based place in Meta's impressions-sorted pull, per advertiser
  impressionsRange: [number, number] | null;
  impressionsPerDay: number | null;
  euReach: number | null;
  reachPerDay: number | null;
  transparencyUrl: string | null;
  // Set by ranking
  score: number | null;
  top: boolean;
  rank: number | null;
  clue: string | null; // what it was ranked on, with the number
  excluded: string | null; // why it's out of the ranking (too new, no landing page, a copy, LSA/Maps)
  duplicateOf: string | null;
  // Set by the offer read
  offer: { type: OfferType; text: string } | null;
  offerRank: number | null;
  offerWhy: string | null;
};

export type LandingPage = { url: string; title: string | null; h1: string | null; text: string; offer: string | null; adIds: string[] };

export type ProofLine = { claim: string; adForm: string; source: string };

export type AdContext = {
  business: { name: string; pitch: string; services: string[]; area: string; buyer: string; site: string | null };
  proof: { gap: string; offer: ProofLine[]; promises: ProofLine[]; numbers: ProofLine[]; hold: ProofLine[]; never: string[] };
  reviews: { rating: number | null; count: number | null; placeUrl: string | null; quotes: { author: string; stars: number | null; text: string; date: string | null }[] };
  testimonials: { author: string | null; text: string; source: string }[];
  videos: { url: string; title: string | null; source: string }[];
  pagesRead: string[];
  builtAt: string;
};

export type Angle = "offer" | "speed" | "price" | "trust" | "risk-reversal" | "ask" | "keyword";
export type HeadlineStage = "kept" | "rules" | "buyer" | "repeat" | "spare"; // spare: passed all three, not in the best 15

export type Headline = { id: string; text: string; angle: Angle; stage: HeadlineStage; reason: string | null; wins: number | null; runs: number | null };

export type Matchup = { ours: { headlines: string[]; descriptions: string[] }; theirs: { id: string; advertiser: string; headline: string | null; text: string | null }; confidence: number; why: string };

export type Drafts = {
  headlines: Headline[];
  descriptions: Headline[];
  kept: { headlines: string[]; descriptions: string[]; path1: string; path2: string };
  counts: { written: number; rules: number; buyer: number; variety: number; kept: number };
  matchups: Matchup[];
  landing: { headline: string; subhead: string; offer: string; proof: string[]; sections: { title: string; body: string }[]; cta: string; versus: { url: string; confidence: number; why: string }[] } | null;
  verdict: { publishable: boolean; minConfidence: number; why: string };
  writtenAt: string;
};

export type Published = { customerId: string; campaignId: string | null; campaignName: string; status: "PAUSED"; validateOnly: boolean; at: string; headlines: number; descriptions: number };
