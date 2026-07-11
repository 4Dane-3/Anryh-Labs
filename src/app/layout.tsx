import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Anryh Labs",
  description: "Human-first technologies and open-sourced apps by Anryh Labs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://use.typekit.net/ypg2syz.css" />
      </head>
      <body
        className="antialiased font-manifold"
      >
        {children}
      </body>
    </html>
  );
}
