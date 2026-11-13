"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Crosshair,
  ArrowUpRight,
  BarChart3,
  BellRing,
  CalendarDays,
  Gauge,
  Gift,
  HeartHandshake,
  LayoutDashboard,
  LogOut,
  Menu,
  PhoneCall,
  Search,
  Users,
  UsersRound,
  Wallet,
  X,
} from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import { cn } from "@/lib/utils";

// The admin's places, in three groups. The pill shows one entry per group's main page; the menu shows everything.
type Place = { href: string; label: string; icon: typeof Gauge; hint?: string };
type Group = { id: string; label: string; places: Place[] };

export const OVERVIEW_SECTIONS: Place[] = [
  { href: "/admin#alerts", label: "Alerts & activity", icon: BellRing },
  { href: "/admin#agents", label: "Agents", icon: UsersRound },
  { href: "/admin#affiliates", label: "Affiliates", icon: Gift },
  { href: "/admin#analytics", label: "Page analytics", icon: BarChart3 },
  { href: "/admin#accounts", label: "Accounts & budgets", icon: Wallet },
];

const GROUPS: Group[] = [
  { id: "accounts", label: "Accounts", places: [{ href: "/admin", label: "Overview", icon: Gauge, hint: "Every agent, live" }, ...OVERVIEW_SECTIONS] },
  {
    id: "sales",
    label: "Sales",
    places: [
      { href: "/admin/clients", label: "Clients", icon: Users, hint: "Your CRM" },
      { href: "/admin/calendar", label: "Calendar", icon: CalendarDays, hint: "Meetings and invites" },
    ],
  },
  {
    id: "migz",
    label: "Migz",
    places: [{ href: "/admin/competitors", label: "Competitor ads", icon: Crosshair, hint: "Who advertises, what wins, ads that beat them" }],
  },
  {
    id: "voice",
    label: "Voice",
    places: [
      { href: "/admin/demo-call", label: "New lead call", icon: PhoneCall, hint: "Emma calls and books" },
      { href: "/admin/demo-call?kind=checkin", label: "Post-job check-in", icon: HeartHandshake, hint: "Review and referrals" },
    ],
  },
];

// The pill: the group's main page, with the group's name as the label
const PILL = [
  { href: "/admin", label: "Overview", icon: Gauge, match: (p: string) => p === "/admin" },
  { href: "/admin/clients", label: "Clients", icon: Users, match: (p: string) => p.startsWith("/admin/clients") },
  { href: "/admin/calendar", label: "Calendar", icon: CalendarDays, match: (p: string) => p.startsWith("/admin/calendar") },
  { href: "/admin/competitors", label: "Competitors", icon: Crosshair, match: (p: string) => p.startsWith("/admin/competitors") },
  { href: "/admin/demo-call", label: "Voice", icon: PhoneCall, match: (p: string) => p.startsWith("/admin/demo-call") },
];

function useOutside(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);
}

/** Everything, grouped, with a filter box. Opens from the menu button or ⌘K / Ctrl K. */
function MenuSheet({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useOutside(true, onClose);
  useEffect(() => input.current?.focus(), []);

  const needle = q.trim().toLowerCase();
  const groups = GROUPS.map((g) => ({ ...g, places: g.places.filter((p) => !needle || `${g.label} ${p.label} ${p.hint ?? ""}`.toLowerCase().includes(needle)) })).filter((g) => g.places.length);
  const first = groups[0]?.places[0];

  async function signOut() {
    await createSupabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <motion.div className="fixed inset-0 z-40 bg-[#060c10]/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.aside
        className="fixed inset-y-3 right-3 z-50 flex w-[min(340px,calc(100vw-24px))] flex-col rounded-[26px] border border-white/20 bg-[rgb(18_28_34/0.85)] p-3 backdrop-blur-2xl"
        initial={{ x: "110%" }}
        animate={{ x: 0 }}
        exit={{ x: "110%" }}
        transition={{ type: "spring", stiffness: 420, damping: 40 }}
        aria-label="Admin menu"
      >
        <div className="mb-2 flex items-center justify-between px-3 pt-1">
          <span className="text-sm font-semibold">Admin</span>
          <button onClick={onClose} aria-label="Close menu" className="rounded-lg p-1.5 text-fg-muted hover:bg-white/10 hover:text-fg">
            <X className="size-5" />
          </button>
        </div>
        <label className="mx-1 mb-2 flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2">
          <Search className="size-4 text-fg-faint" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && first) {
                router.push(first.href);
                onClose();
              }
            }}
            placeholder="Jump to…"
            className="w-full bg-transparent text-sm text-fg placeholder:text-fg-faint focus:outline-none"
          />
        </label>
        <nav className="flex-1 space-y-4 overflow-y-auto px-1">
          {groups.map((g) => (
            <div key={g.id}>
              <p className="px-2 pb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-brand/80">{g.label}</p>
              <div className="space-y-0.5">
                {g.places.map((p) => {
                  const active = p.href === pathname;
                  const Icon = p.icon;
                  return (
                    <Link
                      key={p.href}
                      href={p.href}
                      onClick={onClose}
                      className={cn("flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors", active ? "bg-white/15 text-fg" : "text-fg-muted hover:bg-white/10 hover:text-fg")}
                    >
                      <Icon className={cn("size-4", active && "text-brand")} />
                      <span className="flex-1">{p.label}</span>
                      {p.hint && <span className="text-[11px] text-fg-faint">{p.hint}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
          {!groups.length && <p className="px-3 text-[13px] text-fg-faint">Nothing matches “{q}”.</p>}
        </nav>
        <div className="space-y-1 border-t border-white/15 pt-3">
          <Link href="/dashboard" className="flex items-center justify-between rounded-xl px-3 py-2 text-[13px] text-fg-muted hover:bg-white/10 hover:text-fg">
            My agent dashboard <LayoutDashboard className="size-3.5" />
          </Link>
          <a href="/" target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl px-3 py-2 text-[13px] text-fg-muted hover:bg-white/10 hover:text-fg">
            Homepage <ArrowUpRight className="size-3.5" />
          </a>
          <button onClick={signOut} className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[13px] text-fg-faint hover:bg-white/10 hover:text-fg">
            Sign out <LogOut className="size-3.5" />
          </button>
        </div>
      </motion.aside>
    </>
  );
}

/** The admin's top bar: same glass as the agent dashboard, in orange. Name left, the four places in a pill, menu right. */
export function AdminTopBar() {
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMenu((m) => !m);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <header className="sticky top-0 z-30">
      <div
        aria-hidden="true"
        className={cn("absolute inset-0 -z-10 border-b transition-[background-color,border-color] duration-300", scrolled ? "border-white/10 bg-[rgb(14_24_30/0.6)] backdrop-blur-xl" : "border-transparent")}
      />
      <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 sm:px-8 lg:grid-cols-[1fr_auto_1fr]">
        <Link href="/admin" className="flex items-center gap-2.5 justify-self-start text-[17px] font-semibold tracking-tight text-fg">
          <span className="size-5 -rotate-45 rounded-md border-[2.5px] border-brand border-r-transparent" aria-hidden="true" />
          anryh labs
          <span className="rounded-full bg-brand px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-brand-fg">admin</span>
        </Link>

        <nav aria-label="Admin" className="hidden items-center gap-0.5 rounded-2xl border border-white/20 bg-white/10 p-1 backdrop-blur-xl lg:flex">
          {PILL.map(({ href, label, icon: Icon, match }) => {
            const active = match(pathname);
            return (
              <Link key={href} href={href} className={cn("relative rounded-xl px-3.5 py-2 text-sm transition-colors", active ? "text-fg" : "text-fg-muted hover:text-fg")}>
                {active && <motion.span layoutId="admin-top-active" className="absolute inset-0 rounded-xl bg-white/15" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                <span className="relative inline-flex items-center gap-2">
                  <Icon className={cn("size-4", active ? "text-brand" : "text-fg-faint")} />
                  {label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 justify-self-end">
          <button
            type="button"
            onClick={() => setMenu(true)}
            className="hidden h-11 items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-3 text-[13px] text-fg-muted backdrop-blur-xl transition-colors hover:bg-white/15 hover:text-fg sm:flex"
          >
            <Search className="size-4" /> Jump to <kbd className="rounded-md bg-white/10 px-1.5 font-mono text-[11px]">⌘K</kbd>
          </button>
          <button
            type="button"
            onClick={() => setMenu(true)}
            aria-label="Open menu"
            className="flex size-11 items-center justify-center rounded-2xl bg-brand text-brand-fg shadow-[0_8px_24px_-8px_rgb(255_106_19/0.6)] transition-transform active:scale-95"
          >
            <Menu className="size-5" />
          </button>
        </div>
      </div>
      <AnimatePresence>{menu && <MenuSheet onClose={() => setMenu(false)} />}</AnimatePresence>
    </header>
  );
}

/** The heading every admin page opens with: a small orange eyebrow, the title, a line under it, actions on the right. */
export function PageHead({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pt-2">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-brand">{eyebrow}</p>
        <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 max-w-xl text-sm text-fg-muted">{description}</p>}
      </div>
      {action}
    </header>
  );
}

/** A sticky strip of jump links for a long page; the one in view lights up as you scroll. */
export function SectionNav({ sections }: { sections: Place[] }) {
  const ids = sections.map((s) => s.href.split("#")[1]);
  const [current, setCurrent] = useState(ids[0]);
  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setCurrent(top.target.id);
      },
      { rootMargin: "-120px 0px -55% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join()]);

  return (
    <div className="sticky top-[68px] z-20 -mx-1 overflow-x-auto px-1 py-1 [scrollbar-width:none]">
      <div className="inline-flex gap-1 rounded-2xl border border-white/15 bg-[rgb(14_24_30/0.45)] p-1 backdrop-blur-xl">
        {sections.map(({ href, label, icon: Icon }) => {
          const id = href.split("#")[1];
          const on = current === id;
          return (
            <a
              key={id}
              href={`#${id}`}
              onClick={() => setCurrent(id)}
              className={cn("relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-[13px] transition-colors", on ? "text-fg" : "text-fg-muted hover:text-fg")}
            >
              {on && <motion.span layoutId="admin-section" className="absolute inset-0 rounded-xl bg-brand/20 ring-1 ring-brand/40" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
              <Icon className={cn("relative size-3.5", on ? "text-brand" : "text-fg-faint")} />
              <span className="relative">{label}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
