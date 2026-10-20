"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

// Formats in the visitor's own timezone, which the server can't know; renders blank during SSR.
export function BookedTime({ iso }: { iso: string }) {
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!isClient) return <span>{" "}</span>;

  const d = new Date(iso);
  return (
    <span>
      {d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} at{" "}
      {d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}
    </span>
  );
}
