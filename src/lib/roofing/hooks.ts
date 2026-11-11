// What makes a roofing ad's first two seconds work on Meta, shared by the presenter script writer and Migz's own
// creative briefs. Roofing runs in Meta's Housing special ad category, so the audience is everyone in the radius:
// the hook does the targeting. Call out the place and the house, never the person (no age, family or background),
// and never claim a credential, number or offer the roofer didn't give.

export const ROOFING_HOOK_RULES = [
  "The first 2 seconds decide the ad. Open with a callout that makes the right homeowner stop: the town plus who it's for (\"Kenmore homeowners\", \"Bothell, if your roof is 15+ years old\"), or a question they already ask themselves (\"Is your roof ready for another winter?\", \"Seeing granules in your gutters?\").",
  "Call out the place and the house, never the person: town names, roof age, shingle type, moss, missing shingles, last week's real storm. Never age, gender, family, income or background (Meta's Housing category and personal-attribute rules), and never say the viewer's roof is damaged.",
  "Hooks that work for roofers: the town callout; the roof-age callout; a visible sign to check for (granules, curling shingles, moss, water stains); the owner's credibility (\"I'm Gil, a CertainTeed ShingleMaster roofer in Kenmore\"), but only with a certification the roofer actually gave; the honest reason (\"Most roof leaks start years before you see them\"); and a real local offer they gave.",
  "Name a certification (CertainTeed ShingleMaster, GAF Master Elite, Owens Corning Preferred and the like) only when it's in the roofer's facts, exactly as written there. Same for offers, reviews, years in business and warranties: none of them are invented.",
  "Keep it short and spoken: one idea per sentence, local words, end on the free inspection and Tap Learn More.",
].join(" ");

/** Badges a roofer can pick from, as a shortcut. They still have to hold it. */
export const BADGE_SUGGESTIONS = ["CertainTeed ShingleMaster", "GAF Master Elite", "Owens Corning Preferred Contractor", "Licensed & insured", "BBB A+ rated"];
