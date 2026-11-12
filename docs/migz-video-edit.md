# How Migz edits a video ad

Migz gets the footage from HeyGen (the roofer, or whoever they chose, talking to camera, lips matched) or
Higgsfield (job b-roll and every other video), then edits on top of it with HyperFrames and ffmpeg until it is a
finished ad. The bar is a premium creator edit, clean, cinematic, fast and restrained, in the style of the best
short-form editors. It must never look like an AI template.

The rules below are enforced in code: the plan is built in `src/lib/edit/` (pure, tested in
`scripts/migz/edit.test.mts`) and rendered by the worker in `render-worker/`. When a number here changes, change
it there too.

## 0. What goes in

- **Footage**: the talking video and up to four cut-aways from the roofer's own photos and clips, each tagged in
  setup with what it shows (crew working, inspection, damage, finished roof, drone, team and trucks). One of each kind
  first, a real clip before a photo, different picks from one video to the next. Real clips cut in as they are
  (their first second skipped, 4 seconds kept); photos get a slow Higgsfield camera move that adds nothing to the
  scene (at most three per video). For the AI
  presenter, their photo (even a selfie) becomes a HeyGen photo avatar, and from it a **jobsite look**: them standing
  at a roofing job, waist up, holding a tablet, plain work hoodie (no logos), crew on the roof and a truck behind,
  moody overcast light. Every video is made from that look, never from the raw photo. Or the roofer's own recording.
- **Brand**, from the setup page:
  - their website, scanned for the heading font, body font, background, text and one accent colour;
  - their logo;
  - deals, certifications, license number and warranties.
  Only what they gave ever appears on screen.
- **Who's on camera**: name, role and how to say the name (the voice reads the pronunciation; captions keep the
  spelling), introduced once.
- **Voice**: their own, cloned (ElevenLabs instant clone, background noise removed) from a minute or two they
  record in setup by reading lines that cover what ads say, or from an upload. Spoken with Eleven v3 at "Natural"
  stability, which reads punctuation like a person; the script is written to be spoken (contractions, mixed sentence
  lengths, a breath where a comma is), never three same-shaped sentences in a row.

## 1. Takes

- For their own recording: transcribe it with word times. When a line is said more than once, keep the last
  complete take unless it stumbles or is clipped.
- HeyGen footage is one take.

## 2. Tight cut

- Remove every pause over 0.15s, breaths between sentences, ums and restarts.
- Never cut mid-word. Leave 2 frames of handle on each side, with a 5ms audio fade at every cut so nothing
  clicks.

## 3. Grade

- Clean cinematic grade: gentle S-curve contrast, natural warm skin, slightly warm highlights, slightly cool
  shadows, saturation down a touch, soft vignette, very light film grain.
- The same grade on the talking video and the b-roll, with exposure matched so cuts don't flicker.

## 4. Zooms

- One frame from the talking video finds the face; every zoom centres on the eyes.
- Two framings, alternating on every jump cut: wide (100%) and close (115% on 1080p sources, 110% on 720p).
- Smooth push-ins on emphasis words (numbers, towns, certifications, the offer, "free"): 0.4s, expo out. No
  shake, no bounce.

## 5. Captions and design

The reference is a premium roofer ad: the owner at the job, text on the torso, never on the face.

- **Captions** are 2 to 4 words in two weights: the lead words small and light in white (about 58px), then the
  stressed words big and bold in the brand accent with a soft glow (up to 116px). They never start or end on a
  little word ("a", "the", "us"). The lead slides in, the stressed words punch in on their own word (scale and blur
  in), and the caption blurs away.
- **Hook**: map-pin town tags (a red pin and a glass pill per town, up to three) under one light line, the first one
  on frame 0 and the rest dropping in. Without towns, big uppercase text.
- **Name tag** when they say their name: role in the accent, name big, a divider, the company (last word in the
  accent) and the town with a pin, on glass, with accent focus brackets around the face.
- **Offer**: the deal as an accent pill with a glow, its wording above in light text.
- **Credentials**: glass cards with a kicker ("COMPANY · TOWN"), the certification big with a check, a generic
  shield badge (never a manufacturer's logo); warranty and license with a shield icon.
- **Call to action**: a glass card, "Tap" white and "Learn More" glowing in the accent, "to request your free roof
  inspection" (or free quote), the special in the accent, and a glowing ring with a down arrow that bobs.
- Cut-aways come in and go out through a blur. A soft vignette darkens the edges.
- Names, brands and towns are always spelled exactly as the roofer typed them (for the AI presenter the transcript
  is spelled like the script, since the voice read it).
- **Safe zone**: nothing in the top 220px, bottom 420px or right 140px of the 1080x1920 frame.
- When the face fills the frame (a close selfie in their own recording), the video shrinks toward the top over a
  blurred copy of itself so the text has room.

## 6. Sync map

Each effect lands within 2 frames of the start of its word.

| Moment | What happens |
|---|---|
| Frame 0 | A tight punch-in on the face, with the hook text (the callout, like "KENMORE HOMEOWNERS") readable on mute within the first second. No static wide shot. |
| 0–3s | Something changes every 1 to 1.5 seconds: a cut between framings, a push-in or a graphic. |
| End of the hook sentence | Captions switch on and the hook text fades out. |
| A town is said | A town pin card. |
| A certification is said | A certification card (their logo if they gave one). |
| "Licensed" or the license is said | A license card with their license number. |
| "Warranty" is said | The warranty card, exactly as they wrote it. |
| A number is said | The number as big kinetic text ($500 OFF, 25 YEARS). |
| A roof problem or the work is described | A cut-away to the clip that shows it ("inspection" or "check" → an inspection, "leaks" or "moss" → damage, "crew" or "replacement" → the crew at work, "roof" → drone or a finished roof), each clip once, with a soft swoosh. |
| "Learn More" | Riser, then the Tap Learn More card with their logo. |
| Last word | It ends on a frame identical to frame 0, so the video loops. |

- Between beats, change something every 2 to 4 seconds (a cut, a zoom or a graphic), and never let 4 seconds go
  by without a change.
- Never stack two effects on the same beat.
- If a move doesn't add meaning, leave the line clean. Restraint beats decoration.

## 7. Sound

- **Voice**: light denoise, high-pass at 80Hz, gentle compression. The ad is mastered at -14 LUFS with peaks at
  -1 dBTP.
- **Music**: 18 to 22 dB under the voice, ducked while they talk, ending cleanly on the last word.
- **Sound effects** go only on the beats above and some zooms: click on a hard cut, whoosh on a zoom, pop on a
  card, swoosh on a cut-away, riser before the last card. If it sounds like a meme edit, it's too much.

## 8. Quality check before anyone sees it

Every check must pass before the video goes to the roofer for approval:

1. **Sync**: every effect within 2 frames of its word.
2. **Faces**: no text or graphic over the face, shadows included.
3. **Safe zone**: nothing in the top 220px, bottom 420px or right 140px.
4. **Cuts**: no clipped words and no mid-word cuts.
5. **Captions**: every name and brand spelled as given.
6. **Audio**: -14 LUFS (±1), peaks at or below -1 dBTP, music ducked.
7. **Loop**: the last frame matches frame 0.
8. **Picture**: no black frames, no flashes, no frozen frames.

- The plan checks (1–5) run before rendering, and anything that fails is moved or dropped.
- The render checks (6–8) run on the finished file.
- If a render check still fails, the video falls back to the simple edit, and staff are told why.

## 9. Output

1080x1920 at 30fps, H.264 at about 18 Mbps, AAC 320k. The roofer approves the preview before
anything reaches Meta.

## Not built yet

- Graphics behind the speaker's head, which needs a subject cut-out.
- Re-editing an old ad the roofer already ran.
