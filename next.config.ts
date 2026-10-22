import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure Turbopack resolves from this project root (avoids picking /Users/dane)
  turbopack: {
    root: __dirname,
  },
  // Migz pulls frames from video ads and mixes narration on the server with a bundled ffmpeg binary
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/cron/migz": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/dashboard/**": ["./node_modules/ffmpeg-static/ffmpeg"],
    // Finished videos get their narration mixed in wherever a creative job is advanced
    "/api/cron/creatives": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/webhooks/higgsfield": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  // Retired pages: send old links somewhere useful
  async redirects() {
    return [
      { source: "/write", destination: "/contact", permanent: true },
      { source: "/pairo", destination: "/", permanent: true },
      { source: "/status", destination: "/", permanent: true },
      { source: "/careers", destination: "/", permanent: true },
    ];
  },
  // Required headers for FFmpeg WASM (SharedArrayBuffer support)
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
