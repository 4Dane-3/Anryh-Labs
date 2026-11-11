// One render: the job from the app (its HyperFrames HTML, the kept stretches, media URLs, the sound cues) in, a
// finished, checked 1080x1920 MP4 out. Run on its own for a local test:
//   node render.mjs job.json out.mp4
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

const ff = (args, timeout = 600_000) => run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], { timeout, maxBuffer: 64 * 1024 * 1024 });
/** ffmpeg's report (stderr) for an analysis pass. */
async function analyse(args, timeout = 600_000) {
  try {
    const r = await run(FFMPEG, ["-hide_banner", "-nostats", ...args, "-f", "null", "-"], { timeout, maxBuffer: 64 * 1024 * 1024 });
    return r.stderr;
  } catch (e) {
    return String(e.stderr ?? "");
  }
}

async function download(url, file) {
  if (url.startsWith("file://")) return copyFile(new URL(url), file);
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`Couldn't download ${new URL(url).pathname.split("/").pop()} (${res.status})`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

async function info(file) {
  const r = await analyse(["-i", file]);
  const d = r.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const v = r.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  const fps = r.match(/([\d.]+) fps/);
  return { seconds: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : null, width: v ? +v[1] : null, height: v ? +v[2] : null, fps: fps ? +fps[1] : null, hasAudio: /Audio:/.test(r) };
}

async function meanLuma(file) {
  const r = await analyse(["-i", file, "-vf", "fps=2,scale=270:-1,signalstats,metadata=print:key=lavfi.signalstats.YAVG"]);
  const ys = [...r.matchAll(/YAVG=([\d.]+)/g)].map((m) => +m[1]);
  return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
}

// The grade: gentle S-curve, warm highlights, cool shadows, a touch less saturation, soft vignette, light grain
const GRADE = "curves=master='0/0 0.25/0.22 0.5/0.5 0.75/0.79 1/1',colorbalance=rs=-0.02:bs=0.035:rh=0.035:gh=0.01:bh=-0.03,eq=saturation=0.92,vignette=angle=0.42,noise=alls=3:allf=t";
const FRAME = (fps) => `scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,fps=${fps},setsar=1`;

const SFX_VOLUME = { hit: 0.5, click: 0.3, whoosh: 0.32, pop: 0.22, swoosh: 0.3, riser: 0.35 };

export async function render(job, outFile, log = console.log) {
  const dir = await mkdtemp(join(tmpdir(), "migz-edit-"));
  const project = join(dir, "project");
  await mkdir(join(project, "fonts"), { recursive: true });
  const fps = job.fps;
  try {
    // 1. Media in
    log("downloading media");
    await download(job.media.talk, join(dir, "talk-src.mp4"));
    const src = await info(join(dir, "talk-src.mp4"));
    if (!src.hasAudio) throw new Error("The talking video has no sound");
    await Promise.all(job.media.broll.map((u, i) => download(u, join(dir, `broll${i}-src.mp4`))));
    const fontFiles = await Promise.all(job.fonts.map((f) => download(f.url, join(project, "fonts", f.file)).then(() => true, () => false)));
    let logoName = null;
    if (job.media.logo) {
      const raw = join(dir, "logo-src");
      await download(job.media.logo, raw);
      const head = (await readFile(raw)).subarray(0, 200).toString("utf8");
      if (/<svg|<\?xml/i.test(head)) {
        logoName = "logo.svg";
        await copyFile(raw, join(project, logoName));
      } else {
        logoName = "logo.png";
        await ff(["-i", raw, "-frames:v", "1", join(project, logoName)]);
      }
    }
    await copyFile(require.resolve("gsap/dist/gsap.min.js"), join(project, "gsap.min.js"));

    // 2-3. Tight cut and grade: the kept stretches joined, a 5ms audio fade at every cut so nothing clicks
    log(`cutting ${job.segments.length} stretches and grading`);
    const parts = job.segments.map((s, i) => {
      const d = s.to - s.from;
      return `[0:v]trim=start=${s.from.toFixed(4)}:end=${s.to.toFixed(4)},setpts=PTS-STARTPTS[v${i}];[0:a]atrim=start=${s.from.toFixed(4)}:end=${s.to.toFixed(4)},asetpts=PTS-STARTPTS,afade=t=in:d=0.005,afade=t=out:st=${Math.max(0, d - 0.005).toFixed(4)}:d=0.005[a${i}]`;
    });
    const concat = `${job.segments.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${job.segments.length}:v=1:a=1[cv][ca]`;
    await ff(["-i", join(dir, "talk-src.mp4"), "-filter_complex", `${parts.join(";")};${concat};[cv]${FRAME(fps)},${GRADE},format=yuv420p[gv]`, "-map", "[gv]", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "14", join(project, "talk.mp4"), "-map", "[ca]", "-vn", "-c:a", "pcm_s16le", "-ar", "48000", join(dir, "voice.wav")]);
    await ff(["-i", join(project, "talk.mp4"), "-frames:v", "1", join(project, "frame0.png")]);

    // The job clips: same frame, same grade, exposure matched to the talking video so cuts don't flicker
    const talkY = await meanLuma(join(project, "talk.mp4"));
    for (const [i] of job.media.broll.entries()) {
      const y = await meanLuma(join(dir, `broll${i}-src.mp4`));
      const lift = talkY !== null && y !== null ? Math.max(-0.08, Math.min(0.08, (talkY - y) / 255)) : 0;
      await ff(["-i", join(dir, `broll${i}-src.mp4`), "-vf", `${FRAME(fps)},eq=brightness=${lift.toFixed(3)},${GRADE},format=yuv420p`, "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "16", join(project, `broll${i}.mp4`)]);
    }

    // 4-6. The composition
    let html = job.html;
    if (logoName === "logo.svg") html = html.replace(/\.\/logo\.png/g, "./logo.svg");
    if (!logoName) html = html.replace(/<img class="logo"[^>]*>/g, "");
    if (fontFiles.some((ok) => !ok)) log("a font file didn't download; the composition falls back to the system font for it");
    await writeFile(join(project, "index.html"), html);
    log("rendering the composition");
    const { createRenderJob, executeRenderJob } = await import("@hyperframes/producer");
    const picture = join(dir, "picture.mp4");
    let last = -10;
    await executeRenderJob(createRenderJob({ fps, quality: "high" }), project, picture, (j) => {
      const p = Math.round(j.progress ?? 0);
      if (p >= last + 10) {
        log(`  ${p}%`);
        last = p;
      }
    });

    // 8. Sound: voice cleaned, music under it and ducked, effects on their beats, mastered to -14 LUFS / -1 dBTP
    log("mixing the sound");
    const seconds = job.seconds;
    const inputs = ["-i", join(dir, "voice.wav")];
    const fmt = "aformat=sample_rates=48000:channel_layouts=stereo";
    const chains = [`[0:a]highpass=f=80,afftdn=nr=8:nf=-30,acompressor=threshold=-20dB:ratio=3:attack=8:release=160:makeup=3,${fmt},apad=whole_dur=${seconds.toFixed(3)},asplit=2[voice][key]`];
    const mix = ["[voice]"];
    let n = 1;
    if (job.media.music) {
      await download(job.media.music, join(dir, "music.mp3"));
      inputs.push("-stream_loop", "-1", "-i", join(dir, "music.mp3"));
      const fadeAt = Math.max(0, job.musicEnd - 1.2);
      // About 14 dB under the voice between lines, ducked another 6-8 while they talk (18-22 dB under)
      chains.push(`[${n}:a]atrim=duration=${seconds.toFixed(3)},${fmt},loudnorm=I=-29:TP=-3:LRA=7,afade=t=in:d=0.3,afade=t=out:st=${fadeAt.toFixed(3)}:d=1.2[bed]`);
      chains.push(`[bed][key]sidechaincompress=threshold=0.02:ratio=4:attack=20:release=300:makeup=1[music]`);
      mix.push("[music]");
      n++;
    } else chains.push("[key]anullsink");
    for (const kind of Object.keys(SFX_VOLUME)) {
      const at = job.sfx.filter((s) => s.kind === kind && s.at < seconds - 0.15);
      if (!at.length || !job.media.sfx?.[kind]) continue;
      const f = join(dir, `sfx-${kind}`);
      await download(job.media.sfx[kind], f);
      inputs.push("-i", f);
      const labels = at.map((_, i) => `[${kind}${i}]`);
      chains.push(`[${n}:a]${fmt},volume=${SFX_VOLUME[kind]}${at.length > 1 ? `,asplit=${at.length}` : ""}${labels.join("")}`);
      at.forEach((s, i) => {
        const ms = Math.max(0, Math.round(s.at * 1000));
        chains.push(`${labels[i]}adelay=${ms}|${ms}[${kind}d${i}]`);
        mix.push(`[${kind}d${i}]`);
      });
      n++;
    }
    chains.push(`${mix.join("")}amix=inputs=${mix.length}:normalize=0:duration=first,atrim=duration=${seconds.toFixed(3)}[pre]`);
    const premix = join(dir, "premix.wav");
    await ff([...inputs, "-filter_complex", chains.join(";"), "-map", "[pre]", "-c:a", "pcm_s24le", premix]);
    const master = async (input, output) => {
      const m = await analyse(["-i", input, "-af", "loudnorm=I=-14:TP=-1.2:LRA=11:print_format=json"]);
      const j = JSON.parse(m.slice(m.lastIndexOf("{"), m.lastIndexOf("}") + 1));
      const ln = `loudnorm=I=-14:TP=-1.2:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
      // A 20ms fade at each end: the loop point never pops
      await ff(["-i", input, "-af", `${ln},alimiter=limit=0.89:level=false,afade=t=in:d=0.02,afade=t=out:st=${(seconds - 0.03).toFixed(3)}:d=0.03`, "-ar", "48000", "-c:a", "pcm_s24le", output]);
    };
    const mastered = join(dir, "master.wav");
    await master(premix, mastered);

    // 9. The file: 1080x1920, H.264 about 18 Mbps, AAC 320k
    log("encoding");
    await ff(["-i", picture, "-i", mastered, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "slow", "-profile:v", "high", "-pix_fmt", "yuv420p", "-b:v", "18M", "-maxrate", "20M", "-bufsize", "36M", "-r", String(fps), "-c:a", "aac", "-b:a", "320k", "-t", seconds.toFixed(3), "-movflags", "+faststart", outFile]);

    // Checks on the finished file
    log("checking the file");
    const stats = await measure(outFile, fps);
    if (stats.lufs !== null && Math.abs(stats.lufs + 14) > 1) {
      // Once more from the finished mix
      const again = join(dir, "master2.wav");
      await master(mastered, again);
      await ff(["-i", picture, "-i", again, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-t", seconds.toFixed(3), "-movflags", "+faststart", `${outFile}.tmp.mp4`]);
      await copyFile(`${outFile}.tmp.mp4`, outFile);
      await rm(`${outFile}.tmp.mp4`, { force: true });
      Object.assign(stats, await measure(outFile, fps));
    }
    return stats;
  } finally {
    if (!process.env.KEEP_WORK) await rm(dir, { recursive: true, force: true });
    else log(`work kept in ${dir}`);
  }
}

/** Loudness, true peak, black and frozen frames, and how closely the last frame matches frame 0. */
export async function measure(file, fps) {
  const i = await info(file);
  const loud = await analyse(["-i", file, "-af", "ebur128=peak=true", "-vn"]);
  const summary = loud.slice(loud.lastIndexOf("Summary:"));
  const lufs = summary.match(/I:\s+(-?[\d.]+) LUFS/);
  const tp = summary.match(/Peak:\s+(-?[\d.]+) dBFS/);
  const black = await analyse(["-i", file, "-vf", "blackdetect=d=0.03:pix_th=0.06", "-an"]);
  const blackFrames = [...black.matchAll(/black_duration:([\d.]+)/g)].reduce((n, m) => n + Math.round(+m[1] * fps), 0);
  const frozen = await analyse(["-i", file, "-vf", "freezedetect=n=0.002:d=1", "-an"]);
  const frozenSeconds = [...frozen.matchAll(/freeze_duration: ([\d.]+)/g)].reduce((n, m) => Math.max(n, +m[1]), 0);
  // Frame 0 and the last frame as stills, then compared
  const end = Math.max(0, (i.seconds ?? 0) - 2 / fps);
  const a = `${file}.first.png`;
  const b = `${file}.last.png`;
  await ff(["-i", file, "-frames:v", "1", a]);
  await ff(["-sseof", `-${(2 / fps).toFixed(3)}`, "-i", file, "-frames:v", "1", b]).catch(() => ff(["-ss", end.toFixed(3), "-i", file, "-frames:v", "1", b]));
  // Compared small and softened, so film grain (different on every frame) doesn't count as a difference
  const ssim = await analyse(["-i", a, "-i", b, "-lavfi", "[0]scale=270:-1,gblur=sigma=1.2[x];[1]scale=270:-1,gblur=sigma=1.2[y];[x][y]ssim"]);
  await Promise.all([rm(a, { force: true }), rm(b, { force: true })]);
  const all = ssim.match(/All:([\d.]+)/);
  return { lufs: lufs ? +lufs[1] : null, truePeak: tp ? +tp[1] : null, blackFrames, frozenSeconds, loopMatch: all ? +all[1] : null, seconds: i.seconds, width: i.width, height: i.height };
}

// node render.mjs job.json out.mp4
if (import.meta.url === `file://${process.argv[1]}`) {
  const [jobFile, out = "out.mp4"] = process.argv.slice(2);
  const job = JSON.parse(await readFile(jobFile, "utf8"));
  const stats = await render(job, out);
  console.log(JSON.stringify(stats, null, 2));
}
