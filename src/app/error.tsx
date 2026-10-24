"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/error-report";

// The page for an error anywhere outside the dashboard (the public booking pages, the admin, ...).
// Errors from the server carry a digest and were already reported by the server with their real message.
export default function SiteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (!error.digest) reportClientError("boundary", error);
  }, [error]);
  return (
    <div className="mx-auto mt-24 max-w-md rounded-xl border border-slate-200 bg-white px-6 py-8 text-center text-slate-900 shadow-sm">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-600">We&apos;ve been told and we&apos;re looking into it. Reloading the page usually fixes it.</p>
      <div className="mt-5 flex justify-center gap-2">
        <button type="button" onClick={() => window.location.reload()} className="rounded-md bg-blue-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-800">
          Reload
        </button>
        <button type="button" onClick={reset} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900">
          Try again
        </button>
      </div>
    </div>
  );
}
