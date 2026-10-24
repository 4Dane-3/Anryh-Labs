"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/error-report";

/** Reports script errors and unhandled promise rejections from any page (mounted once, in the root layout). */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportClientError("window", e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => reportClientError("rejection", e.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
