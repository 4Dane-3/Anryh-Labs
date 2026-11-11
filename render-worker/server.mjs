// The render worker's HTTP side. The app POSTs a job (with the shared secret), gets 202 straight away, and the
// worker renders one job at a time: the finished MP4 goes to the app's signed upload URL, then the result (with
// the checks) to the app's callback, signed with the same secret.
//   RENDER_WORKER_SECRET=... PORT=8080 node server.mjs
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "./render.mjs";

const SECRET = process.env.RENDER_WORKER_SECRET;
if (!SECRET) throw new Error("RENDER_WORKER_SECRET is not set");
const PORT = Number(process.env.PORT || 8080);
const queue = [];
let running = null;

const sign = (body) => createHmac("sha256", SECRET).update(body).digest("hex");
function authorized(req) {
  const got = Buffer.from(String(req.headers.authorization ?? ""));
  const want = Buffer.from(`Bearer ${SECRET}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

async function report(job, result) {
  const body = JSON.stringify({ jobId: job.jobId, ...result });
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(job.callback, { method: "POST", headers: { "Content-Type": "application/json", "x-render-signature": sign(body) }, body }).catch(() => null);
    if (res?.ok) return;
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  console.error(job.jobId, "couldn't reach the callback");
}

async function work() {
  if (running || !queue.length) return;
  running = queue.shift();
  const job = running;
  const out = join(tmpdir(), `${job.jobId}.mp4`);
  const started = Date.now();
  try {
    const stats = await render(job, out, (m) => console.log(job.jobId, m));
    const bytes = await readFile(out);
    const up = await fetch(job.upload, { method: "PUT", headers: { "Content-Type": "video/mp4", "x-upsert": "true" }, body: bytes });
    if (!up.ok) throw new Error(`Upload failed (${up.status}): ${(await up.text()).slice(0, 200)}`);
    await report(job, { ok: true, stats, seconds: Math.round((Date.now() - started) / 1000) });
  } catch (e) {
    console.error(job.jobId, e);
    await report(job, { ok: false, error: String(e?.message ?? e).slice(0, 500) });
  } finally {
    await rm(out, { force: true });
    running = null;
    work();
  }
}

createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, running: running?.jobId ?? null, queued: queue.length }));
  }
  if (req.method !== "POST" || req.url !== "/render") return res.writeHead(404).end();
  if (!authorized(req)) return res.writeHead(401).end();
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 5_000_000) return res.writeHead(413).end();
  }
  let job;
  try {
    job = JSON.parse(raw);
  } catch {
    return res.writeHead(400).end();
  }
  if (!job.jobId || !job.html || !job.media?.talk || !job.upload || !job.callback || !Array.isArray(job.segments)) return res.writeHead(400).end();
  if (running?.jobId === job.jobId || queue.some((j) => j.jobId === job.jobId)) {
    res.writeHead(202, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ queued: true, duplicate: true }));
  }
  queue.push(job);
  res.writeHead(202, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ queued: true, position: queue.length }));
  work();
}).listen(PORT, () => console.log(`render worker on :${PORT}`));
