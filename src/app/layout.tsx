import type { Metadata } from "next";
import "./globals.css";
import { ErrorReporter } from "@/components/ErrorReporter";
import { SITE_NAME, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  openGraph: { siteName: SITE_NAME, type: "website", locale: "en_US" },
  title: "anryh labs · ai ad automation for insurance agents",
  description:
    "migz ai, the media buyer from anryh labs, runs your whole meta campaign: it reads the analytics and fixes what holds results back so more prospects book a call. invite only.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Lets CSS hide things for entrance animations only when script is running */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
        <link rel="stylesheet" href="https://use.typekit.net/ypg2syz.css" />
      </head>
      <body
        className="antialiased font-manifold"
      >
        <ErrorReporter />
        {children}
      </body>
    </html>
  );
}
