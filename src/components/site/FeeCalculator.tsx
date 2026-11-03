"use client";

import { useState } from "react";
import { MIN_FUNDS, SETUP_FEE, feeFor, pct, usd } from "@/lib/pricing";

/** Type or slide an amount of ad funds to see the fee slice by slice and what's left for ads. */
export function FeeCalculator() {
  const [funds, setFunds] = useState(2000);
  const result = feeFor(funds);

  return (
    <form className="cx-calc" onSubmit={(e) => e.preventDefault()} aria-label="fee calculator">
      <label className="cx-calc__in">
        <span>ad funds you add</span>
        <span className="cx-calc__field">
          $
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={100}
            value={Number.isFinite(funds) ? funds : ""}
            onChange={(e) => setFunds(Math.max(0, Math.min(1_000_000, Number(e.target.value))))}
          />
        </span>
      </label>
      <input
        className="cx-calc__range"
        type="range"
        min={MIN_FUNDS}
        max={50000}
        step={500}
        value={Math.min(Math.max(funds, MIN_FUNDS), 50000)}
        onChange={(e) => setFunds(Number(e.target.value))}
        aria-label="ad funds you add"
      />
      {result ? (
        <>
          <ul className="cx-calc__slices">
            {result.slices.map((s) => (
              <li key={s.label}>
                <span>
                  {pct(s.rate)} of {s.label} ({usd(s.amount)})
                </span>
                <b>{usd(s.fee)}</b>
              </li>
            ))}
          </ul>
          <dl className="cx-calc__out">
            <div>
              <dt>our fee in all</dt>
              <dd>{usd(result.fee)}</dd>
            </div>
            <div>
              <dt>overall rate</dt>
              <dd>{pct(Math.round(result.effectiveRate * 1000) / 1000)}</dd>
            </div>
            <div>
              <dt>your ad budget</dt>
              <dd>{usd(result.adBudget)}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="cx-calc__min">the minimum is {usd(MIN_FUNDS)}.</p>
      )}
      <p className="cx-calc__note">plus the one-time {usd(SETUP_FEE)} setup fee the first time. no monthly fee.</p>
    </form>
  );
}
