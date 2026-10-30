"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  BrainCircuit,
  CalendarDays,
  Film,
  Gauge,
  Gift,
  ListChecks,
  LogOut,
  Menu,
  PanelsTopLeft,
  Rocket,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import { initials } from "@/lib/dashboard/format";
import { FetchedBrainCard } from "@/components/dashboard/brain/BrainCard";
import { cn } from "@/lib/utils";

// The everyday places sit in the pill; the rest live in the menu
const MAIN = [
  { href: "/dashboard", label: "Overview", icon: Gauge },
  { href: "/dashboard/brain", label: "Migz AI Brain", icon: BrainCircuit },
  { href: "/dashboard/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/dashboard/clients", label: "Clients", icon: Users },
  { href: "/dashboard/creatives", label: "Creatives", icon: Film },
  { href: "/dashboard/funds", label: "Ad funds", icon: Wallet },
];
const MORE = [
  { href: "/dashboard/landing", label: "My page", icon: PanelsTopLeft },
  { href: "/dashboard/questions", label: "Questions", icon: ListChecks },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
  { href: "/dashboard/affiliates", label: "Affiliates", icon: Gift },
];

type AgentSummary = { name: string; slug: string; photoUrl: string | null };

const isActive = (pathname: string, href: string) => (href === "/dashboard" ? pathname === href : pathname.startsWith(href));

/** A small glass pop-out under a top-bar button; closes on Escape or a click outside. */
function useOutside<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open, close]);
  return ref;
}

function BrainButton({ connected }: { connected: boolean }) {
  const pathname = usePathname();
  // Open on the page it was opened on, so moving to another page closes it
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const ref = useOutside<HTMLDivElement>(open, () => setOpenOn(null));
  // Overview already shows the brain at the top right: the button just points there
  const onOverview = pathname === "/dashboard";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => (onOverview ? document.getElementById("migz-brain")?.scrollIntoView({ behavior: "smooth", block: "center" }) : setOpenOn(open ? null : pathname))}
        aria-expanded={onOverview ? undefined : open}
        aria-label="Migz AI Brain: see Migz AI working"
        title="See Migz AI working"
        className="relative flex size-11 items-center justify-center rounded-2xl bg-white text-[#0b1a3e] shadow-[0_8px_24px_-8px_rgb(0_0_0/0.4)] transition-transform active:scale-95"
      >
        <BrainCircuit className="size-5" />
        {connected && <span className="absolute right-2 top-2 size-1.5 animate-pulse rounded-full bg-[#5aa83a]" aria-hidden="true" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.25, 0.8, 0.25, 1] }}
            className="absolute right-0 top-full z-50 mt-3 w-[min(380px,calc(100vw-32px))] origin-top-right"
          >
            {connected ? (
              <FetchedBrainCard className="bg-[rgb(40_70_130/0.55)]" />
            ) : (
              <div className="rounded-[26px] border border-white/20 bg-[rgb(40_70_130/0.55)] px-5 py-6 text-[13px] text-fg-muted backdrop-blur-2xl">
                Migz AI starts working once your ad account is linked.
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuSheet({ agent, devLogin, setupDone, staff, onClose }: { agent: AgentSummary; devLogin: boolean; setupDone: boolean; staff: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await createSupabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const item = (href: string, label: string, Icon: typeof Gauge) => (
    <Link
      key={href}
      href={href}
      onClick={onClose}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
        isActive(pathname, href) ? "bg-white/15 text-fg" : "text-fg-muted hover:bg-white/10 hover:text-fg",
      )}
    >
      <Icon className={cn("size-4", isActive(pathname, href) && "text-brand")} />
      {label}
    </Link>
  );

  return (
    <>
      <motion.div className="fixed inset-0 z-40 bg-[#050b1f]/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.aside
        className="fixed inset-y-3 right-3 z-50 flex w-[min(320px,calc(100vw-24px))] flex-col rounded-[26px] border border-white/20 bg-[rgb(18_34_78/0.85)] p-3 backdrop-blur-2xl"
        initial={{ x: "110%" }}
        animate={{ x: 0 }}
        exit={{ x: "110%" }}
        transition={{ type: "spring", stiffness: 420, damping: 40 }}
        aria-label="Menu"
      >
        <div className="mb-2 flex items-center justify-between px-3 pt-1">
          <span className="text-sm font-semibold">Menu</span>
          <button onClick={onClose} aria-label="Close menu" className="rounded-lg p-1.5 text-fg-muted hover:bg-white/10 hover:text-fg">
            <X className="size-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto">
          {item("/dashboard/start", setupDone ? "Setup" : "Start here", Rocket)}
          {/* the pill holds these on wide screens; on phones they're only here */}
          <div className="lg:hidden">{MAIN.map((n) => item(n.href, n.label, n.icon))}</div>
          {MORE.map((n) => item(n.href, n.label, n.icon))}
        </nav>
        <div className="space-y-2 border-t border-white/15 pt-3">
          {staff && (
            <Link href="/admin" className="flex items-center justify-between rounded-xl px-3 py-2 text-[13px] text-brand hover:bg-white/10">
              Admin dashboard <ShieldCheck className="size-3.5" />
            </Link>
          )}
          <a
            href={`/${agent.slug}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded-xl px-3 py-2 text-[13px] text-fg-muted hover:bg-white/10 hover:text-fg"
          >
            View my page <ArrowUpRight className="size-3.5" />
          </a>
          <div className="flex items-center gap-3 px-3 pb-1">
            {agent.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={agent.photoUrl} alt="" crossOrigin="anonymous" className="size-8 rounded-full object-cover" />
            ) : (
              <span className="flex size-8 items-center justify-center rounded-full bg-white/15 text-xs font-semibold text-fg-muted">{initials(agent.name)}</span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{agent.name}</p>
              {devLogin ? <p className="text-[11px] text-brand">Dev login (no password)</p> : <p className="truncate text-[11px] text-fg-faint">/{agent.slug}</p>}
            </div>
            <button onClick={signOut} title="Sign out" aria-label="Sign out" className="rounded-lg p-1.5 text-fg-faint hover:bg-white/10 hover:text-fg">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </motion.aside>
    </>
  );
}

/** The dashboard's top bar: name left, the main places in a glass pill, Migz AI Brain and the menu on the right. */
export function TopBar({
  agent,
  devLogin,
  setupDone,
  staff = false,
  connected,
}: {
  agent: AgentSummary;
  devLogin: boolean;
  setupDone: boolean;
  staff?: boolean;
  connected: boolean;
}) {
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  // Frosted once the page scrolls under it, clear at the top like the reference
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b transition-[background-color,border-color] duration-300",
        scrolled ? "border-white/10 bg-[rgb(10_19_46/0.55)] backdrop-blur-xl" : "border-transparent",
      )}
    >
      <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 sm:px-8 lg:grid-cols-[1fr_auto_1fr]">
        <Link href="/dashboard" className="flex items-center gap-2.5 justify-self-start text-[17px] font-semibold tracking-tight text-fg">
          <span className="size-5 -rotate-45 rounded-md border-[2.5px] border-white border-r-transparent" aria-hidden="true" />
          anryh labs
        </Link>

        <nav
          aria-label="Dashboard"
          className="hidden items-center gap-0.5 rounded-2xl border border-white/20 bg-white/10 p-1 backdrop-blur-xl lg:flex"
        >
          {!setupDone && (
            <Link href="/dashboard/start" className="mr-1 inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-sm font-semibold text-brand-fg">
              <Rocket className="size-3.5" /> Start here
            </Link>
          )}
          {MAIN.map(({ href, label }) => {
            const active = isActive(pathname, href);
            return (
              <Link key={href} href={href} className={cn("relative rounded-xl px-3.5 py-2 text-sm transition-colors", active ? "text-fg" : "text-fg-muted hover:text-fg")}>
                {active && <motion.span layoutId="top-active" className="absolute inset-0 rounded-xl bg-white/15" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                <span className="relative inline-flex items-center gap-2">
                  {active && <i className="size-1.5 rounded-full bg-brand" aria-hidden="true" />}
                  {label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 justify-self-end">
          <BrainButton connected={connected} />
          <button
            type="button"
            onClick={() => setMenu(true)}
            aria-label="Open menu"
            className="flex size-11 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-fg backdrop-blur-xl transition-colors hover:bg-white/15"
          >
            <Menu className="size-5" />
          </button>
        </div>
      </div>
      <AnimatePresence>{menu && <MenuSheet agent={agent} devLogin={devLogin} setupDone={setupDone} staff={staff} onClose={() => setMenu(false)} />}</AnimatePresence>
    </header>
  );
}
