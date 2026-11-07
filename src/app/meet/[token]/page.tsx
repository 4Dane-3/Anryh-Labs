import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMeetingByToken, getSettings } from "@/lib/crm/data";
import { whenText } from "@/lib/crm/invite-email";
import { clientFirstName, clientLabel } from "@/lib/crm/types";
import { respondToMeeting } from "./actions";
import { SubmitButton } from "./SubmitButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your meeting", robots: { index: false, follow: false } };

// Where the invite email's Confirm button lands. Shows the meeting and asks the client to press Confirm
// (or say they can't make it); once confirmed it's a thank-you page with the join link. White and slate,
// like the other pages clients and prospects see.
export default async function MeetingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [m, settings] = await Promise.all([getMeetingByToken(token), getSettings()]);
  if (!m) notFound();
  const w = whenText(m);
  const first = clientFirstName(m.client) ?? clientLabel(m.client);
  const past = new Date(m.ends_at) < new Date();
  const confirm = respondToMeeting.bind(null, token, "confirm");
  const decline = respondToMeeting.bind(null, token, "decline");
  const reschedule = respondToMeeting.bind(null, token, "reschedule");
  const missed = m.outcome === "no_show";

  const state =
    m.status === "cancelled"
      ? { title: "This meeting is cancelled.", body: m.cancelled_by === "client" ? `Thanks for letting us know. ${settings.from_name} will reach out to find another time.` : `${settings.from_name} cancelled this meeting. Reply to the invite email to find another time.` }
      : missed
        ? m.reschedule_requested_at
          ? { title: `Thanks, ${first}.`, body: `${settings.from_name} will reach out to find a new time that works.` }
          : { title: "Looks like we missed each other.", body: `No worries, it happens. Ask for another time and ${settings.from_name} will reach out to set it up.` }
        : past
        ? { title: "This meeting has passed.", body: `Reply to the invite email if you'd like to meet again.` }
        : m.status === "confirmed"
          ? { title: `Thanks, ${first}. You're confirmed.`, body: `${settings.from_name} will see you then. The calendar invite is attached to the email we sent.` }
          : { title: `${first}, can you make it?`, body: `${settings.from_name} would like to meet with you. Press confirm to lock in the time.` };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12 text-slate-900 [color-scheme:light] sm:py-20">
      <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <p className="text-sm font-medium text-slate-500">{settings.from_name}</p>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">{state.title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{state.body}</p>

        <div className="mt-6 divide-y divide-slate-200 rounded-xl border border-slate-200">
          <div className="px-4 py-3.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{m.title}</p>
            <p className={`mt-2 text-base font-semibold ${m.status === "cancelled" ? "line-through decoration-slate-400" : ""}`}>{w.day}</p>
            <p className="text-[15px] text-slate-600">{w.time}</p>
          </div>
          {m.status !== "cancelled" && !past && (m.meeting_url || m.meeting_details) && (
            <div className="px-4 py-3.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Where</p>
              {m.meeting_url && (
                <a href={m.meeting_url} className="mt-2 block break-all text-[15px] font-semibold text-slate-900 underline decoration-slate-300 underline-offset-2">
                  {m.meeting_url}
                </a>
              )}
              {m.meeting_details && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{m.meeting_details}</p>}
            </div>
          )}
        </div>

        {missed && !m.reschedule_requested_at && (
          <form action={reschedule} className="mt-6">
            <SubmitButton pendingLabel="One moment…" className="w-full rounded-full bg-slate-900 px-5 py-3.5 text-[15px] font-semibold text-white transition hover:bg-slate-800 active:scale-[0.99]">
              Ask for another time
            </SubmitButton>
            <p className="mt-3 text-center text-sm text-slate-500">Or reply to the email with a few times that suit you.</p>
          </form>
        )}

        {m.status !== "cancelled" && !past && (
          <div className="mt-6 space-y-3">
            {m.status !== "confirmed" && (
              <form action={confirm}>
                <SubmitButton pendingLabel="Confirming…" className="w-full rounded-full bg-slate-900 px-5 py-3.5 text-[15px] font-semibold text-white transition hover:bg-slate-800 active:scale-[0.99]">
                  Confirm I&apos;ll be there
                </SubmitButton>
              </form>
            )}
            <form action={decline}>
              <SubmitButton pendingLabel="One moment…" className="w-full rounded-full px-5 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700">
                {m.status === "confirmed" ? "Something came up? Cancel" : "I can't make it"}
              </SubmitButton>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}
