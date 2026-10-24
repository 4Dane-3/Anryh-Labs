"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/error-report";

// Last resort: an error in the root layout itself, which replaces the whole document.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    if (!error.digest) reportClientError("boundary", error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "Arial, Helvetica, sans-serif", margin: 0, background: "#fff", color: "#0f172a" }}>
        <div style={{ maxWidth: 420, margin: "96px auto", padding: "32px 24px", textAlign: "center", border: "1px solid #e2e8f0", borderRadius: 12 }}>
          <h1 style={{ fontSize: 18, margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#475569", marginTop: 8 }}>We&apos;ve been told and we&apos;re looking into it. Reloading the page usually fixes it.</p>
          <button onClick={() => window.location.reload()} style={{ marginTop: 20, background: "#1d4ed8", color: "#fff", border: 0, borderRadius: 6, padding: "8px 14px", fontWeight: 600, cursor: "pointer" }}>
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
