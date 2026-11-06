import "server-only";

// Optional: creates a real Zoom meeting (its own join link, meeting ID and passcode) for each CRM meeting.
// Needs a Zoom "Server-to-Server OAuth" app in the Zoom App Marketplace with the meeting:write:meeting
// scope (meeting:write:admin on older apps), and its ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and
// ZOOM_CLIENT_SECRET. Without them the CRM uses the meeting link from its settings (a personal meeting
// room or Google Meet link) or one pasted per meeting.

export const zoomReady = () => !!process.env.ZOOM_ACCOUNT_ID && !!process.env.ZOOM_CLIENT_ID && !!process.env.ZOOM_CLIENT_SECRET;

let cached: { token: string; until: number } | null = null;

async function accessToken() {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const basic = Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(process.env.ZOOM_ACCOUNT_ID!)}`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Zoom sign-in failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, until: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function zoom(path: string, init: RequestInit) {
  const res = await fetch(`https://api.zoom.us/v2${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok && res.status !== 404) throw new Error(`Zoom ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 || res.status === 404 ? null : res.json();
}

/** Creates (or, with an id, moves) a scheduled meeting on the Zoom account's owner. */
export async function upsertZoomMeeting(input: { id?: string | null; topic: string; startsAt: string; minutes: number; timezone: string }) {
  const body = JSON.stringify({ topic: input.topic.slice(0, 200), type: 2, start_time: input.startsAt.replace(/\.\d{3}Z$/, "Z"), duration: input.minutes, timezone: input.timezone, settings: { join_before_host: false, waiting_room: true } });
  if (input.id) {
    await zoom(`/meetings/${input.id}`, { method: "PATCH", body });
    const m = (await zoom(`/meetings/${input.id}`, { method: "GET" })) as { id: number; join_url: string; password?: string } | null;
    if (m) return { id: String(m.id), joinUrl: m.join_url, details: zoomDetails(m.id, m.password) };
  }
  const m = (await zoom("/users/me/meetings", { method: "POST", body })) as { id: number; join_url: string; password?: string };
  return { id: String(m.id), joinUrl: m.join_url, details: zoomDetails(m.id, m.password) };
}

export async function deleteZoomMeeting(id: string) {
  await zoom(`/meetings/${id}`, { method: "DELETE" });
}

function zoomDetails(id: number, password?: string) {
  const pretty = String(id).replace(/(\d{3})(\d{3,4})(\d{4})$/, "$1 $2 $3");
  return `Zoom meeting ID: ${pretty}${password ? `\nPasscode: ${password}` : ""}`;
}
