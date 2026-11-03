import type { Faq } from "@/lib/seo/insurance-types";
import "@/components/site/content.css";

/** Questions and answers, all visible (not folded away), so people and crawlers read the same text. */
export function FaqList({ faqs }: { faqs: Faq[] }) {
  return (
    <dl className="cx-faq">
      {faqs.map((f) => (
        <div key={f.q}>
          <dt>{f.q}</dt>
          <dd>{f.a}</dd>
        </div>
      ))}
    </dl>
  );
}
