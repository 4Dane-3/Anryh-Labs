import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

// Open to search engines and to the crawlers behind AI assistants (so they can read and cite the site);
// closed to the dashboard, the admin, the API and agents' private flows.
const PRIVATE = ["/dashboard", "/admin", "/api/", "/auth", "/login", "/join/", "/o/"];

const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: "/", disallow: PRIVATE })),
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl(),
  };
}
