import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure Turbopack resolves from this project root (avoids picking /Users/dane)
  turbopack: {
    root: __dirname,
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
