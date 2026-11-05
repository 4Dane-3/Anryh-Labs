"use client";

import { useEffect } from "react";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{ background: "#14213d", color: "#fff", border: 0, borderRadius: 999, padding: "10px 18px", fontWeight: 600, fontSize: 14, cursor: "pointer" }}
    >
      Print or save as PDF
    </button>
  );
}

/** Shrinks the full-size cards to fit a narrow screen; printing always uses their real size. */
export function FitCards() {
  useEffect(() => {
    const fit = () =>
      document.querySelectorAll<HTMLElement>(".card, .hanger").forEach((el) => {
        const inches = el.classList.contains("hanger") ? 4.25 : 9;
        el.style.setProperty("zoom", String(Math.min(1, (window.innerWidth - 32) / (inches * 96))));
      });
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return null;
}
