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
    // Agents' own sites (lib/booking/sites.ts) run their booking page on these public APIs from the browser
    const cors = [
      { key: "Access-Control-Allow-Origin", value: "*" },
      { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
      { key: "Access-Control-Allow-Headers", value: "Content-Type" },
      { key: "Access-Control-Max-Age", value: "86400" },
    ];
    return [
      { source: "/api/agents/:slug/:part(slots|events|visit|profile)", headers: cors },
      { source: "/api/bookings", headers: cors },
      // A partner site's "help them prepare" page reads the booking and saves the optional answers
      { source: "/api/bookings/prepare", headers: cors },
      { source: "/api/intake", headers: cors },
      { source: "/api/quotes", headers: cors },
      {
        // Not on My page: its preview frames the agent's page on their agency's site, which these would block
        source: "/((?!dashboard/landing).*)",
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
