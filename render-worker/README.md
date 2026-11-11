# Migz render worker

Turns an edit plan from the app into a finished ad. The steps:

1. Cut the talking video to its kept stretches.
2. Grade it and the job clips, with exposure matched.
3. Render the HyperFrames composition (captions, cards, zooms, cut-aways, loop) at 1080x1920.
4. Mix the sound: the voice cleaned, music ducked under it, sound effects on their beats, mastered to -14 LUFS
   and -1 dBTP.
5. Encode at H.264 18 Mbps with AAC 320k.
6. Check the file: loudness, peaks, black and frozen frames, and that the last frame matches frame 0.

The rules are in [docs/migz-video-edit.md](../docs/migz-video-edit.md). The plan and the HTML are built in the app
(`src/lib/edit/`). This service only executes them, so it holds no API keys and no database access.

## Run it

```bash
docker build -t migz-render-worker render-worker
docker run -p 8080:8080 -e RENDER_WORKER_SECRET=... migz-render-worker
```

Any host that runs a Docker image works, for example Fly.io, Railway or Render. Give it 2 CPUs and 4 GB of memory.
A 30-second ad takes a few minutes, one job at a time.

## Connect the app

Set these on the app (Vercel), then redeploy:

- `RENDER_WORKER_URL`: the worker's public URL, like `https://migz-render.fly.dev`.
- `RENDER_WORKER_SECRET`: the same long random string as the worker.

Until both are set, videos use the simpler built-in edit.

## Local test

This needs Node 22 and ffmpeg.

```bash
cd render-worker && npm install
node render.mjs job.json out.mp4
```

`job.json` is what the app sends. `scripts/migz/edit-local.mts` writes one from local files.
