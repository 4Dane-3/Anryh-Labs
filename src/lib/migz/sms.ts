import { createHmac, timingSafeEqual } from "node:crypto";

// Text messages through Twilio. Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_SMS_FROM (a number or
// messaging service SID that has passed US A2P 10DLC registration).

export const smsReady = () => !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN && !!process.env.TWILIO_SMS_FROM;

export async function sendSms(to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_SMS_FROM;
  if (!sid || !token || !from) throw new Error("Twilio texting isn't set up");
  const form = new URLSearchParams({ To: to, Body: body.slice(0, 1200), ...(from.startsWith("MG") ? { MessagingServiceSid: from } : { From: from }) });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/** Twilio's request signature: the full URL plus each form field, sorted, signed with the auth token. */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", authToken).update(data).digest("base64");
}

export function validTwilioSignature(authToken: string, url: string, params: Record<string, string>, given: string) {
  const a = Buffer.from(twilioSignature(authToken, url, params));
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A US number as +1XXXXXXXXXX, or null. */
export function normalizeUsPhone(raw: string) {
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^[2-9]\d{9}$/.test(ten) ? `+1${ten}` : null;
}
