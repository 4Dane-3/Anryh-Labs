"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/clients", label: "Clients" },
  { href: "/admin/calendar", label: "Calendar" },
  { href: "/admin/demo-call", label: "Demo call" },
];

/** Switches between the admin overview and the CRM (clients, calendar). */
export function AdminNav() {
  const path = usePathname();
  const active = TABS.slice().reverse().find((t) => path === t.href || path.startsWith(`${t.href}/`))?.href ?? "/admin";
  return (
    <nav className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-8">
      <div className="inline-flex rounded-lg border border-line bg-ink-raised p-1">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className={cn("relative rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors", active === t.href ? "text-fg" : "text-fg-muted hover:text-fg")}>
            {active === t.href && <motion.span layoutId="admin-nav" className="absolute inset-0 rounded-md bg-white/[0.08]" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <span className="relative">{t.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
