"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  BrainCircuit,
  CalendarDays,
  Film,
  Gauge,
  ListChecks,
  LogOut,
  Menu,
  PanelsTopLeft,
  Rocket,
  Settings,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import { initials } from "@/lib/dashboard/format";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: Gauge },
  { href: "/dashboard/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/dashboard/clients", label: "Clients", icon: Users },
  { href: "/dashboard/brain", label: "Migz brain", icon: BrainCircuit },
  { href: "/dashboard/funds", label: "Ad funds", icon: Wallet },
  { href: "/dashboard/creatives", label: "Creatives", icon: Film },
  { href: "/dashboard/landing", label: "My page", icon: PanelsTopLeft },
  { href: "/dashboard/questions", label: "Questions", icon: ListChecks },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

type AgentSummary = { name: string; slug: string; photoUrl: string | null };

function NavLinks({ onNavigate, setupDone }: { onNavigate?: () => void; setupDone: boolean }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);
  const onStart = pathname.startsWith("/dashboard/start");

  return (
    <nav className="space-y-0.5">
      {!setupDone && (
        <Link
          href="/dashboard/start"
          onClick={onNavigate}
          className={cn(
            "mb-2 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-[background-color,transform] active:scale-[0.99]",
            onStart ? "bg-brand text-brand-fg" : "bg-brand/90 text-brand-fg hover:bg-brand",
          )}
        >
          <Rocket className="size-4" />
          Start here
        </Link>
      )}
      {setupDone && (
        <Link
          href="/dashboard/start"
          onClick={onNavigate}
          className={cn("relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors", onStart ? "text-fg" : "text-fg-muted hover:text-fg")}
        >
          <Rocket className={cn("size-4", onStart && "text-brand")} />
          Setup
        </Link>
      )}
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active ? "text-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            {active && (
              <motion.span
                layoutId="nav-active"
                className="absolute inset-0 rounded-lg bg-white/[0.07]"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <Icon className={cn("relative size-4", active && "text-brand")} />
            <span className="relative">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function AgentFooter({ agent, devLogin }: { agent: AgentSummary; devLogin: boolean }) {
  const router = useRouter();

  async function signOut() {
    await createSupabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="space-y-3 border-t border-line pt-4">
      <a
        href={`/${agent.slug}`}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-between rounded-lg px-3 py-2 text-[13px] text-fg-muted transition-colors hover:bg-white/[0.05] hover:text-fg"
      >
        View my page <ArrowUpRight className="size-3.5" />
      </a>
      <div className="flex items-center gap-3 px-3">
        {agent.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={agent.photoUrl}
            alt=""
            crossOrigin="anonymous"
            className="size-8 rounded-full object-cover"
          />
        ) : (
          <span className="flex size-8 items-center justify-center rounded-full bg-ink-high text-xs font-semibold text-fg-muted">
            {initials(agent.name)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{agent.name}</p>
          {devLogin ? (
            <p className="text-[11px] text-brand">Dev login (no password)</p>
          ) : (
            <p className="truncate text-[11px] text-fg-faint">/{agent.slug}</p>
          )}
        </div>
        <button
          onClick={signOut}
          title="Sign out"
          aria-label="Sign out"
          className="rounded-md p-1.5 text-fg-faint transition-colors hover:bg-white/[0.05] hover:text-fg"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function Sidebar({ agent, devLogin, setupDone }: { agent: AgentSummary; devLogin: boolean; setupDone: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile menu with Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const current = NAV.find((n) =>
    n.href === "/dashboard" ? pathname === n.href : pathname.startsWith(n.href),
  );

  return (
    <>
      {/* Desktop */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-ink px-3 py-5 lg:flex">
        <div className="mb-6 flex items-center gap-2.5 px-3">
          <span className="flex size-6 items-center justify-center rounded-md bg-brand text-[11px] font-bold text-brand-fg">
            A
          </span>
          <span className="text-sm font-semibold">Agent dashboard</span>
        </div>
        <div className="flex-1">
          <NavLinks setupDone={setupDone} />
        </div>
        <AgentFooter agent={agent} devLogin={devLogin} />
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-ink/90 px-4 py-3 backdrop-blur lg:hidden">
        <span className="text-sm font-semibold">{current?.label ?? "Dashboard"}</span>
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="rounded-md p-1.5 text-fg-muted hover:bg-white/[0.05] hover:text-fg"
        >
          <Menu className="size-5" />
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="scrim"
              className="fixed inset-0 z-40 bg-black/60 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.aside
              key="sheet"
              className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-line bg-ink px-3 py-4 lg:hidden"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 420, damping: 40 }}
            >
              <div className="mb-4 flex items-center justify-between px-3">
                <span className="text-sm font-semibold">Agent dashboard</span>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="rounded-md p-1.5 text-fg-muted hover:bg-white/[0.05] hover:text-fg"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="flex-1">
                <NavLinks onNavigate={() => setOpen(false)} setupDone={setupDone} />
              </div>
              <AgentFooter agent={agent} devLogin={devLogin} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
