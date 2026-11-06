import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireAgent } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { bookingAddress } from "@/lib/booking/data";
import { landingUrl } from "@/lib/booking/sites";
import { cityOf, displayPhone, printLink, streetOf } from "@/lib/roofing/print";
import { isRoofer } from "@/lib/verticals";
import { FitCards, PrintButton } from "./PrintButton";

// A booked inspection's print sheet: the neighbor postcard (front and back, 6.5 x 9 in) and a door hanger
// (4.25 x 11 in) for that street. Linked from the roofer's booking email and the morning-of reminder. Only the
// roofer who owns the booking can open it. Nothing on it names the customer.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Postcard & door hanger", robots: { index: false } };

const CSS = `
  :root { --navy:#14213d; --orange:#f26a1b; --cream:#fff6ea; --ink:#1d1d1f; --mute:#5b6270; }
  .sheet { background:#e7e4de; min-height:100vh; padding:24px 16px 48px; font-family:"Helvetica Neue",Arial,sans-serif; color:var(--ink); }
  .bar { max-width:864px; margin:0 auto 18px; display:flex; flex-wrap:wrap; gap:12px; align-items:center; justify-content:space-between; }
  .bar h1 { font-size:16px; margin:0; }
  .bar p { margin:4px 0 0; font-size:13px; color:var(--mute); max-width:560px; line-height:1.45; }
  .label { text-align:center; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--mute); margin:26px 0 8px; }
  .wrap { display:flex; justify-content:center; }
  .card { width:9in; height:6.5in; background:#fff; position:relative; overflow:hidden; box-shadow:0 10px 30px rgba(0,0,0,.18); flex:none; }
  .front { display:grid; grid-template-columns:1.25fr 1fr; }
  .front .left { background:var(--navy); color:#fff; padding:44px 40px; display:flex; flex-direction:column; }
  .badge { align-self:flex-start; background:var(--orange); color:#fff; font-weight:700; font-size:13px; letter-spacing:.06em; text-transform:uppercase; padding:7px 12px; border-radius:4px; }
  .front h2 { font-size:40px; line-height:1.08; margin:20px 0 14px; font-weight:800; }
  .front h2 span { color:#ffb27d; }
  .front .left p { font-size:18px; line-height:1.45; margin:0; color:#dfe5f2; }
  .cta { margin-top:auto; display:flex; align-items:center; gap:18px; }
  .cta .btn { background:var(--orange); color:#fff; font-weight:800; font-size:19px; padding:14px 20px; border-radius:6px; }
  .cta .or { font-size:15px; color:#cfd7ea; line-height:1.3; }
  .cta .or b { display:block; color:#fff; font-size:22px; }
  .front .right { background:linear-gradient(#cfe6f7,#eaf4fb 62%,#9fcf86 62%); position:relative; }
  .front .right svg { position:absolute; inset:0; width:100%; height:100%; }
  .tag { position:absolute; left:18px; right:18px; bottom:20px; background:rgba(20,33,61,.92); color:#fff; padding:12px 14px; border-radius:6px; font-size:14px; line-height:1.35; }
  .tag b { color:#ffb27d; }
  .back { display:grid; grid-template-columns:1.1fr 1fr; background:var(--cream); }
  .msg { padding:32px 34px 40px; display:flex; flex-direction:column; }
  .msg h3 { margin:0 0 14px; font-size:25px; color:var(--navy); font-weight:800; }
  .steps { list-style:none; padding:0; margin:0 0 16px; }
  .steps li { display:flex; gap:12px; margin-bottom:10px; font-size:15.5px; line-height:1.35; }
  .n { flex:none; width:27px; height:27px; border-radius:50%; background:var(--orange); color:#fff; font-weight:800; display:grid; place-items:center; font-size:14px; }
  .scan { margin-top:auto; display:flex; align-items:center; gap:14px; background:#fff; border:2px solid var(--navy); border-radius:8px; padding:10px 12px; }
  .qr { width:100px; height:100px; flex:none; }
  .qr svg { width:100%; height:100%; display:block; }
  .scan b { display:block; font-size:18px; color:var(--navy); }
  .scan small { color:var(--mute); font-size:13px; }
  .postal { border-left:1px dashed #cdbfae; padding:30px 28px; display:flex; flex-direction:column; justify-content:space-between; }
  .indicia { align-self:flex-end; width:150px; height:96px; border:1.5px dashed #9aa1af; display:grid; place-items:center; text-align:center; font-size:11px; color:#7d8594; line-height:1.4; padding:8px; }
  .addr { font-size:18px; line-height:1.5; }
  .addr small { display:block; font-size:12px; color:var(--mute); letter-spacing:.04em; }
  .from { font-size:12px; color:var(--mute); line-height:1.5; }
  .legal { position:absolute; left:34px; bottom:12px; width:52%; font-size:10px; color:var(--mute); line-height:1.35; }
  .hanger { width:4.25in; height:11in; background:#fff; position:relative; overflow:hidden; box-shadow:0 10px 30px rgba(0,0,0,.18); flex:none; display:flex; flex-direction:column; }
  .hole { height:2.1in; background:var(--navy); position:relative; }
  .hole::after { content:""; position:absolute; left:50%; top:.55in; width:1.35in; height:1.35in; margin-left:-.675in; border-radius:50%; background:#e7e4de; box-shadow:inset 0 0 0 2px #0b1428; }
  .hole .slit { position:absolute; left:50%; top:0; width:2px; height:.6in; background:#e7e4de; }
  .hbody { padding:22px 24px 26px; display:flex; flex-direction:column; flex:1; }
  .hbody h2 { font-size:28px; line-height:1.1; margin:12px 0 10px; color:var(--navy); font-weight:800; }
  .hbody h2 span { color:var(--orange); }
  .hbody p { font-size:15px; line-height:1.45; margin:0 0 12px; color:#333a46; }
  .check { list-style:none; padding:0; margin:4px 0 14px; }
  .check li { font-size:14.5px; margin-bottom:7px; padding-left:22px; position:relative; }
  .check li::before { content:"✓"; position:absolute; left:0; color:var(--orange); font-weight:800; }
  .hqr { margin-top:auto; text-align:center; border-top:2px solid var(--navy); padding-top:14px; }
  .hqr .qr { width:1.5in; height:1.5in; margin:0 auto 8px; }
  .hqr b { display:block; color:var(--navy); font-size:17px; }
  .hqr small { color:var(--mute); font-size:12.5px; }
  .hlegal { font-size:9.5px; color:var(--mute); margin-top:10px; line-height:1.35; text-align:center; }
  @media print {
    @page { margin:0; }
    .sheet { background:#fff; padding:0; }
    .bar, .label { display:none; }
    .wrap { display:block; overflow:visible; }
    .card, .hanger { box-shadow:none; break-after:page; zoom:1 !important; }
    .postcard-only .hanger, .hanger-only .card { display:none; }
  }
`;

function House() {
  return (
    <svg viewBox="0 0 400 624" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="sh" width="22" height="12" patternUnits="userSpaceOnUse">
          <rect width="22" height="12" fill="#4a4f5c" />
          <path d="M0 11.5h22M11 0v11" stroke="#363a45" strokeWidth="1.4" fill="none" />
        </pattern>
      </defs>
      <circle cx="330" cy="86" r="34" fill="#ffd77a" />
      <rect x="70" y="300" width="270" height="170" fill="#f1e6d6" />
      <polygon points="40,306 205,170 370,306" fill="url(#sh)" />
      <rect x="170" y="370" width="64" height="100" fill="#8a4b2b" />
      <rect x="96" y="348" width="52" height="46" fill="#bfe0f5" stroke="#fff" strokeWidth="4" />
      <rect x="262" y="348" width="52" height="46" fill="#bfe0f5" stroke="#fff" strokeWidth="4" />
      <rect x="0" y="470" width="400" height="154" fill="#9fcf86" />
      <rect x="150" y="470" width="110" height="154" fill="#b9b2a6" />
    </svg>
  );
}

export default async function PrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ only?: string }> }) {
  const [{ id }, { only }] = await Promise.all([params, searchParams]);
  const agent = await requireAgent();
  if (!isRoofer(agent) || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: booking } = await supabaseAdmin.from("bookings").select("id, agent_id").eq("id", id).eq("agent_id", agent.id).maybeSingle();
  if (!booking) notFound();

  const address = await bookingAddress(booking.id);
  const street = streetOf(address);
  const city = cityOf(address) ?? agent.service_area?.split(",")[0] ?? null;
  const place = street ?? (city ? city : "your street");
  const page = landingUrl(agent.slug);
  const qr = async (kind: "postcard" | "door_hanger") =>
    QRCode.toString(printLink(page, kind, street), { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#14213d", light: "#ffffff" } });
  const [postQr, hangQr] = await Promise.all([qr("postcard"), qr("door_hanger")]);
  const phone = displayPhone(agent.call_phone);
  const company = agent.full_name;
  const license = agent.company_license ? ` · License #${agent.company_license}` : "";
  const legal = `${company}${license}. The inspection is free, with no obligation. It isn't a quote or a promise of any repair, price or insurance outcome.`;

  return (
    <div className={`sheet ${only === "postcard" ? "postcard-only" : only === "hanger" ? "hanger-only" : ""}`}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <FitCards />
      <div className="bar">
        <div>
          <h1>Neighbor postcard &amp; door hanger · {place}</h1>
          <p>
            Print the postcard at 6.5 × 9 in (it fits USPS Every Door Direct Mail; your printer adds the postage indicia) and the door hanger at
            4.25 × 11 in. Leave hangers on nearby doors while you&rsquo;re there. Neither names your customer. The QR codes open your booking page,
            tagged so bookings from them show up as print.
          </p>
        </div>
        <PrintButton />
      </div>

      <div className="label">Postcard · front</div>
      <div className="wrap">
        <div className="card front">
          <div className="left">
            <span className="badge">Inspecting on {place} this week</span>
            <h2>
              We&rsquo;re checking roofs on <span>{place}</span>.
            </h2>
            <p>Our crew is already in the neighborhood. Get your roof looked at for free while we&rsquo;re here. No pressure, no obligation.</p>
            <div className="cta">
              <div className="btn">Book a free inspection</div>
              {phone && (
                <div className="or">
                  or call<b>{phone}</b>
                </div>
              )}
            </div>
          </div>
          <div className="right">
            <House />
            <div className="tag">
              <b>Free inspection.</b> We look at your roof top to bottom and tell you what we find, good or bad.
            </div>
          </div>
        </div>
      </div>

      <div className="label">Postcard · back (mailing side)</div>
      <div className="wrap">
        <div className="card back">
          <div className="msg">
            <h3>How it works</h3>
            <ol className="steps">
              <li><span className="n">1</span><span><b>Pick a time</b> that suits you: scan the code{phone ? " or call us" : ""}.</span></li>
              <li><span className="n">2</span><span><b>We inspect your roof.</b> You don&rsquo;t need to climb anything.</span></li>
              <li><span className="n">3</span><span><b>You get straight answers</b> with photos, and a written quote only if something needs work.</span></li>
            </ol>
            <div className="scan">
              <div className="qr" dangerouslySetInnerHTML={{ __html: postQr }} />
              <div>
                <b>Scan to book your free inspection</b>
                <small>{phone ? `Or call ${phone}. ` : ""}Takes about a minute.</small>
              </div>
            </div>
          </div>
          <div className="postal">
            <div className="indicia">USPS indicia<br />(permit, EDDM)<br />added by the printer</div>
            <div className="addr"><small>ECRWSS</small>Postal Customer</div>
            <div className="from">{company}{agent.service_area ? <><br />{agent.service_area}</> : null}</div>
          </div>
          <div className="legal">{legal}</div>
        </div>
      </div>

      <div className="label">Door hanger</div>
      <div className="wrap">
        <div className="hanger">
          <div className="hole"><span className="slit" /></div>
          <div className="hbody">
            <span className="badge">Sorry we missed you</span>
            <h2>
              We&rsquo;re working on <span>{place}</span> today.
            </h2>
            <p>While our crew is nearby, we&rsquo;re offering free roof inspections to the neighbors.</p>
            <ul className="check">
              <li>Shingles, flashing and vents</li>
              <li>Gutters and roof edges</li>
              <li>Photos of what we find</li>
              <li>No pressure, no obligation</li>
            </ul>
            <div className="hqr">
              <div className="qr" dangerouslySetInnerHTML={{ __html: hangQr }} />
              <b>Scan to book a free inspection</b>
              <small>{phone ? `or call ${phone}` : company}</small>
            </div>
            <div className="hlegal">{legal}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
