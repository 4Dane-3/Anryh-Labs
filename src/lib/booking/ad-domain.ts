// The address a roofer's ads send people to is always on their own domain (book.theirroofing.com), never ours.
// They point one DNS record at us; we serve their booking page on that host. Their main website is untouched.

export const AD_DOMAIN_CNAME = "cname.vercel-dns.com";
export const AD_DOMAIN_A = "76.76.21.21";

const OURS = ["anryhlabs.com", "vercel.app", "localhost", "foreignfinancial.org"];

/** A pasted web address as a bare host, or an error for the form. It must be a subdomain (a CNAME can't sit on a bare domain). */
export function cleanAdDomain(input: string): { ok: true; domain: string } | { ok: false; error: string } {
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  if (!host) return { ok: false, error: "Enter the address you want your ads to use, like book.yourbusiness.com." };
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) return { ok: false, error: "That doesn't look like a web address. Use something like book.yourbusiness.com." };
  if (OURS.some((d) => host === d || host.endsWith(`.${d}`))) return { ok: false, error: "Use an address on your own domain, not ours." };
  if (host.split(".").length < 3) return { ok: false, error: "Use a subdomain of your site, like book.yourbusiness.com. The bare domain stays on your website." };
  return { ok: true, domain: host };
}

/** Whether a host is one of ours (so it's never treated as a roofer's ad address). */
export function isOurHost(host: string, appUrl = process.env.APP_URL) {
  const h = host.toLowerCase().replace(/:\d+$/, "");
  let app = "";
  try {
    app = appUrl ? new URL(appUrl).hostname.toLowerCase() : "";
  } catch {}
  return !h || h === app || h === "127.0.0.1" || OURS.some((d) => h === d || h === `www.${d}` || h.endsWith(`.${d}`)) || h.endsWith(".vercel.app");
}

/** The https link ads use for a verified ad address. */
export const adDomainUrl = (domain: string) => `https://${domain}/`;
