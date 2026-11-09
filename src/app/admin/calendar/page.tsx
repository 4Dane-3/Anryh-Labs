import { PageHead } from "@/components/admin/AdminShell";
import { DateTime } from "luxon";
import { getClientOptions, getMeetingsBetween, getSettings } from "@/lib/crm/data";
import { appUrl } from "@/lib/crm/email";
import { zoomReady } from "@/lib/crm/zoom";
import { CalendarView } from "@/components/admin/crm/CalendarView";
import { NeedsMigration } from "@/components/admin/crm/NeedsMigration";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendar · Admin" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; d?: string }> }) {
  const sp = await searchParams;
  const settings = await getSettings();
  const tz = settings.timezone;
  const view = sp.view === "week" ? "week" : "month";
  const parsed = sp.d ? DateTime.fromISO(sp.d, { zone: tz }) : null;
  const anchor = parsed?.isValid ? parsed.startOf("day") : DateTime.now().setZone(tz).startOf("day");
  // A little either side, so the month grid's leading and trailing days show their meetings too
  const from = view === "month" ? anchor.startOf("month").minus({ days: 7 }) : anchor.minus({ days: 7 });
  const to = view === "month" ? anchor.endOf("month").plus({ days: 14 }) : anchor.plus({ days: 8 });
  const [{ ready, meetings }, clients] = await Promise.all([getMeetingsBetween(from.toUTC().toISO()!, to.toUTC().toISO()!), getClientOptions()]);
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 pb-16 pt-6 sm:px-8">
      <PageHead eyebrow="Sales" title="Calendar" description={<>Meetings with your clients. Each invite has a Confirm button; you&apos;ll see here who confirmed.</>} />
      {ready ? <CalendarView view={view} anchor={anchor.toISODate()!} meetings={meetings} clients={clients} settings={settings} zoom={zoomReady()} appUrl={appUrl()} /> : <NeedsMigration />}
    </div>
  );
}
