"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function OurStoryPage() {
  return (
    <div className="min-h-screen flex flex-col bg-black">
      {/* Header */}
      <header className="relative z-20 w-full border-b border-white/10">
        <div className="mx-auto flex h-[75px] max-w-[1336px] items-center justify-between px-6">
          <Link
            href="/"
            className="text-[28px] font-manifold font-bold tracking-tight text-white"
          >
            Anryh Labs
          </Link>

          <nav className="flex items-center gap-6">
            <Link
              href="/our-story"
              className="text-sm text-white hover:text-white transition-colors hidden sm:block"
            >
              Our story
            </Link>
            <Link
              href="/open-source-apps"
              className="text-sm text-white/70 hover:text-white transition-colors hidden sm:block"
            >
              Open-Sourced Apps
            </Link>
            <Link
              href="/companies"
              className="text-sm text-white/70 hover:text-white transition-colors hidden md:block"
            >
              Companies
            </Link>
            <Link
              href="/write"
              className="text-sm text-white/70 hover:text-white transition-colors hidden md:block"
            >
              Write
            </Link>
            <Button className="h-[38px] px-4 bg-white text-black text-sm font-normal rounded-full hover:bg-white/90 transition-colors">
              Get started
            </Button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        <div className="mx-auto max-w-[900px] px-6 py-20">
          {/* Hero Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-16 text-center"
          >
            <h1 className="font-manifold text-[48px] md:text-[64px] leading-[1.1] tracking-[-0.02em] text-white mb-4">
              While most tech begins in a boardroom,
              <br />
              <span className="text-orange-500">
                Anryhlabs began in leasing offices.
              </span>
            </h1>
          </motion.div>

          {/* Story Content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="space-y-8 text-center"
          >
            <p className="text-[21px] text-white/80 leading-relaxed">
              While most tech begins in a boardroom, Anryhlabs found its start
              in the leasing offices of Seattle.
            </p>

            <p className="text-[21px] text-white/80 leading-relaxed">
              Our founders started under the Seattle fog: navigating the
              high-pressure world of Seattle real estate as leasing agents. We
              spent our days managing tours, chasing signatures, and balancing
              the needs of owners and tenants. We saw firsthand the
              inefficiencies in the industry and the need for a better way.
            </p>

            <div className="pt-6">
              <h2 className="font-manifold text-2xl md:text-3xl text-white mb-4">
                The Problem
              </h2>
              <p className="text-[21px] text-white/80 leading-relaxed">
                We grew tired of &quot;all-in-one&quot; platforms that were
                clunky, outdated, and built by people who had never actually
                managed a property. We realized that the industry didn&apos;t
                need more features; it needed better flow, better traffic, and
                technology that puts the people first.
              </p>
            </div>

            <div className="pt-6">
              <h2 className="font-manifold text-2xl md:text-3xl text-white mb-4">
                The Anryhlabs Mission
              </h2>
              <p className="text-[21px] text-white/80 leading-relaxed">
                We decided to trade our master keys for code. We founded
                Anryhlabs with a singular focus: to build the most intuitive,
                high-performance technology specifically for property management
                companies.
              </p>
              <p className="text-[21px] text-white/80 leading-relaxed mt-4">
                Because we’ve been in your shoes, we build with a
                &quot;boots-on-the-ground&quot; perspective. From technologies
                aiding tedious admin tasks to technologies that combat
                vacancies.
              </p>
            </div>

            <div className="pt-6">
              <h2 className="font-manifold text-2xl md:text-3xl text-white mb-4">
                Why We’re Different
              </h2>
              <ul className="space-y-4 text-[21px] text-white/80 leading-relaxed">
                <li>
                  <span className="text-white font-semibold">
                    Agent-Centric Design:
                  </span>{" "}
                  We design workflows based on real-day-in-the-life scenarios,
                  not theoretical business models.
                </li>
                <li>
                  <span className="text-white font-semibold">
                    Seattle-Bred Innovation:
                  </span>{" "}
                  We combine the grit of the local rental market with the
                  world-class tech standards of our home city.
                </li>
                <li>
                  <span className="text-white font-semibold">
                    Purpose-Built Tech:
                  </span>{" "}
                  We don&apos;t do &quot;general&quot; real estate. We do
                  property management, and we do it better than anyone else.
                </li>
              </ul>
            </div>

            <blockquote className="mt-8 border-l-2 border-orange-500/70 pl-6 py-2 text-[21px] text-white/85 italic text-left max-w-[760px] mx-auto">
              “We didn&apos;t just want to enter the prop-tech space. We wanted
              to fix it for the people who actually use it.”
            </blockquote>
          </motion.div>

          {/* Decorative Element */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="mt-20 flex justify-center"
          >
            <div className="w-16 h-1 bg-gradient-to-r from-orange-500 to-orange-300 rounded-full" />
          </motion.div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-20 border-t border-white/10 py-6">
        <div className="mx-auto max-w-[1336px] px-6">
          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-white/40">
            <Link href="/write" className="hover:text-white transition-colors">
              Help
            </Link>
            <Link href="/status" className="hover:text-white transition-colors">
              Status
            </Link>
            <Link
              href="/careers"
              className="hover:text-white transition-colors"
            >
              Careers
            </Link>
            <Link
              href="/privacy"
              className="hover:text-white transition-colors"
            >
              Privacy
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
