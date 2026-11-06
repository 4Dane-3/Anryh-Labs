import { ALSO_INCLUDED, COVERED, EXAMPLE_FUNDS, HOW_IT_ADDS_UP, MIN_FUNDS, NOT_COVERED, ROOFING_MIN_FIRST_MONTH_AD_SPEND, ROOFING_SETUP_FEE, SETUP_FEE, TIERS, feeFor, pct, sliceLabel, usd } from "@/lib/pricing";
import "@/components/site/content.css";

/** The rate for each slice of the amount added, with what the amount costs in all once it reaches the end of that slice. */
export function PricingTiers() {
  return (
    <ol className="cx-tiers" aria-label="rate for each slice of the ad funds you add">
      {TIERS.map((t, i) => {
        const funds = t.upTo ?? 50000;
        const total = feeFor(funds)!;
        return (
          <li key={i}>
            <p className="cx-tier__rate">{pct(t.rate)}</p>
            <p className="cx-tier__band">on {sliceLabel(i)}</p>
            <p className="cx-tier__eg">
              so adding {usd(funds)} costs {usd(total.fee)} in all, and {usd(total.adBudget)} goes to your ads
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** A worked example, line by line, so the brackets are easy to follow. */
export function PricingExample() {
  const e = feeFor(EXAMPLE_FUNDS)!;
  return (
    <div className="cx-example">
      <p className="cx-example__lead">{HOW_IT_ADDS_UP}</p>
      <table>
        <caption>adding {usd(EXAMPLE_FUNDS)}, line by line</caption>
        <thead>
          <tr>
            <th scope="col">slice of what you add</th>
            <th scope="col">amount</th>
            <th scope="col">rate</th>
            <th scope="col">fee</th>
          </tr>
        </thead>
        <tbody>
          {e.slices.map((s) => (
            <tr key={s.label}>
              <th scope="row">{s.label}</th>
              <td>{usd(s.amount)}</td>
              <td>{pct(s.rate)}</td>
              <td>{usd(s.fee)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">total</th>
            <td>{usd(EXAMPLE_FUNDS)}</td>
            <td>{pct(Math.round(e.effectiveRate * 1000) / 1000)}</td>
            <td>{usd(e.fee)}</td>
          </tr>
          <tr>
            <th scope="row">goes to your ads</th>
            <td colSpan={3}>{usd(e.adBudget)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Setup fee, minimum, and what the percentage covers. */
export function PricingCovers() {
  return (
    <div className="cx-covers">
      <div className="cx-setups">
        <div className="cx-setup">
          <p className="cx-setup__who">roofing companies</p>
          <p className="cx-setup__fee">{usd(ROOFING_SETUP_FEE)}</p>
          <p>one-time setup, paid up front. you also need at least {usd(ROOFING_MIN_FIRST_MONTH_AD_SPEND)} in meta ad spend for the first month.</p>
        </div>
        <div className="cx-setup">
          <p className="cx-setup__who">life insurance agents</p>
          <p className="cx-setup__fee">{usd(SETUP_FEE)}</p>
          <p>
            one-time setup. no monthly fee, no contract. the minimum ad funds are {usd(MIN_FUNDS)}, and the percentage is kept from what you add, so the rest is your ad budget.
          </p>
        </div>
      </div>
      <div>
        <h3>the percentage covers</h3>
        <ul className="cx-list">
          {COVERED.map((c) => (
            <li key={c.title}>
              <b>{c.title}:</b> {c.text}
            </li>
          ))}
        </ul>
        <h3>also included</h3>
        <ul className="cx-list">
          {ALSO_INCLUDED.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <h3>not included</h3>
        <ul className="cx-list">
          {NOT_COVERED.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
