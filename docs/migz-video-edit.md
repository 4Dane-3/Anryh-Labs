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
  - their website, scanned for the heading font, body font, background, text and one accent colour (until they
    set one, the default look is vivid blue #2D7FF9 on near-black, `DEFAULT_BRAND` in `src/lib/edit/brand.ts`);
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
  shadows, saturation down a touch, very light film grain. No vignette: the whole frame shows, edges included.
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
  accent) and the town with a pin, on glass.
- **No frame, border or brackets** around the video or the face.
- **Google reviews**: when they mention their reviews ("50 five-star reviews on Google"), a white card with the
  Google "G", the score, five stars and "50 reviews on Google", from the spoken count. Their real Google rating and
  count from the landing page proof (`agent_brand.proof`) win when we have them.
- **Offer**: the deal as an accent pill with a glow, its wording above in light text.
- **Credentials**: glass cards with a kicker ("COMPANY · TOWN"), the certification big with a check, a generic
  shield badge (never a manufacturer's logo); warranty and license with a shield icon.
- **Call to action**: a glass card, "Tap" white and "Learn More" glowing in the accent, "to request your free roof
  inspection" (or free quote), the special in the accent, and a glowing ring with a down arrow that bobs.
- Cut-aways come in and go out through a whip-pan blur. Nothing darkens or frames the edges.
- **Never static.** Every other card drops in from above the frame and bounces for a second before it settles; the
  rest slide or pop in. Every card then floats gently while it's up. Cards you'd tap (the Google reviews, the call to
  action, credentials) get tapped: a cursor glides in, presses, the card dips and a ripple spreads, with a click
  sound. The call to action is tapped every 1.4 seconds until the loop.
- **Emojis** pop beside a caption word and wiggle while it's up: a pin on a town, an ear on "listen", a star on
  reviews, a gift on "free" (`src/lib/edit/emoji.ts`). One per caption at most, at least 1.8 seconds apart.
- **Captions keep showing** while cards are up: cards go above the head, behind it (wide shots) or under the
  captions, and only take the caption band when none of those has room.
- Names, brands and towns are always spelled exactly as the roofer typed them (for the AI presenter the transcript
  is spelled like the script, since the voice read it).
- **Safe zone**: nothing in the top 220px, bottom 420px or right 140px of the 1080x1920 frame.
- When the face fills the frame (a close selfie in their own recording), the video still fills the frame, never shrunk
  with a border. The zoom is gentler (108% at most), captions may cover the chin (the lowest 15% of the face, up to
  30% for a face that fills almost everything), and cards go above the head.
- **Behind the head**: in a wide shot (the face is at most 13% of the frame's height: standing, or sitting back from
  the camera) the reviews, offer, credential and town cards sit behind the head instead, like a sign on the wall:
  centred on the head, the top of the head covering the card's lower middle. They zoom with the shot. The worker
  cuts the person out of the talking video (`render-worker/matte.py`, MediaPipe's selfie segmenter) and draws
  them over the card while it's up. In a selfie, or when there's no room above the head inside the safe zone at
  the biggest zoom, cards stay on the torso in front. The name tag and the call to action are always in front.

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
- **Music**: 18 to 22 dB under the voice, ducked while they talk, ending cleanly on the last word. The client
  picks a mood on their brand form: soft (the default), upbeat, educational, inspiring, luxury, or none
  (`agent_brand.music_mood`, `src/lib/edit/music.ts`). Each mood is one ElevenLabs Music track made once with
  `scripts/migz/make-music.mts --yes` and kept at `creatives/system/music-library/<mood>/`; every video in that
  mood reuses it (more files in a mood take turns). A mood with no track yet makes one on its first video.
- **Sound effects** go only on the beats above and some zooms: click on a hard cut, whoosh on a zoom, pop on a
  card, ding on a big number or the offer, a click on every tap, swoosh on a cut-away. Never a riser before the end. If it sounds like a
  meme edit, it's too much.
- **Our sound library.** Drop a pack in a folder and run `scripts/migz/upload-sfx.mts` on it (a dry run first;
  `--yes` uploads to `creatives/system/sfx-library/<kind>/`). Files are sorted by name (`src/lib/edit/sfx-library.ts`):
  whoosh, swoosh/transition, click/tap, pop/bubble, ding/bell/chime, riser/build-up, hit/impact/boom, or the
  folder's name when the file's says nothing. Anything else is listed and skipped. Several files of a kind take
  turns through an edit, and each is levelled to the same peak before its volume is set, so a loud pack and a
  quiet one sit the same. A kind with no library files falls back to the generated sound.

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

- Re-editing an old ad the roofer already ran.

## Testing an edit on a client's own footage (free, local)

For trying the edit on a founder's selfie video and their b-roll before anything is live. Nothing paid runs: word
times are estimated from the audio's pauses and the script they read.

1. Put the files in one folder with an `edit.json` (every field is described at the top of
   `scripts/migz/edit-local.mts`): the talking video, the script, the b-roll (clips and photos), the sound folder,
   brand colours and fonts, the hook, who's on camera and the names to spell exactly.
2. Plan it. This prints the plan checks, how the sound folder was sorted, and every card and sound with its time:

   ```bash
   node --import tsx scripts/migz/edit-local.mts path/to/edit.json e2e-output/my-test
   ```

3. Render it (Node 22 recommended; it also ran on Node 20.19 with warnings). It uses the installed Chrome:

   ```bash
   cd render-worker && npm ci && node render.mjs ../e2e-output/my-test/job.json ../e2e-output/my-test/final.mp4
   ```

   The render prints the file checks at the end (loudness, peaks, black or frozen frames, loop). `e2e-output/` is
   git-ignored. The render needs to open a local port, so in a sandboxed Claude Code session it needs local binding
   allowed.

Real b-roll clips cut in as they are (their first second skipped when the clip is over 5 seconds, 4 seconds kept).
Photos get a slow push. For exact caption timing, pass a real word-timed transcript as `transcript` instead of
relying on the estimate.

## What we ask clients to film

**The founder selfie (the talking video)**
- Phone upright (9:16), at eye level, propped or on a tripod, arm's length away, head and shoulders in frame with
  space above the head. The rear camera if someone else can press record; otherwise the front camera at 1080p or 4K.
- Face a window or soft light. No bright window behind them.
- A quiet room. A cheap clip-on mic plugged into the phone is the biggest upgrade.
- Read our script one sentence at a time, looking into the lens. If a line goes wrong, pause and say the whole
  sentence again: the edit keeps the last clean take, so there's no need to stop recording.
- Two seconds of silence at the start and end. 30 to 60 seconds of talking is plenty.
- For clinics: scrubs or a clinic jacket in the consult room is the strongest look. Nothing medical on screen
  behind them (no procedure photos, no patient records).

**The b-roll (cut-aways)**
- Upright (9:16) clips of 5 to 10 seconds each, the phone held steady or slowly moving, and nobody talking to the
  camera. 4 to 8 clips is ideal.
- For clinics: the outside and the sign, reception, the consult room, the surgeon and team talking (no audio needed),
  equipment being prepared, a consultation on a screen, hands-on-tablet shots. Never surgery, scalps, grafts, blood
  or a patient who hasn't signed consent for ads.
- Photos work too (they get a slow camera move), but real clips look better and cost nothing.
