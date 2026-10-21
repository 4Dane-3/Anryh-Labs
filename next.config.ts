import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure Turbopack resolves from this project root (avoids picking /Users/dane)
  turbopack: {
    root: __dirname,
  },
  // Migz pulls frames from video ads on the server with a bundled ffmpeg binary
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/cron/migz": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/dashboard/**": ["./node_modules/ffmpeg-static/ffmpeg"],
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
