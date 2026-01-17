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
          <Link href="/" className="text-[28px] font-manifold font-bold tracking-tight text-white">
            Anryh Labs
          </Link>
          
          <nav className="flex items-center gap-6">
            <Link href="/our-story" className="text-sm text-white hover:text-white transition-colors hidden sm:block">
              Our story
            </Link>
            <Link href="/open-source-apps" className="text-sm text-white/70 hover:text-white transition-colors hidden sm:block">
              Open-Sourced Apps
            </Link>
            <Link href="/companies" className="text-sm text-white/70 hover:text-white transition-colors hidden md:block">
              Companies
            </Link>
            <Link href="/write" className="text-sm text-white/70 hover:text-white transition-colors hidden md:block">
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
              Born in the Philippines.
              <br />
              <span className="text-orange-500">Built for Humanity.</span>
            </h1>
          </motion.div>

          {/* Story Content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="space-y-8"
          >
            <p className="text-[21px] text-white/80 leading-relaxed">
              Anryh Labs was forged in the resilience of the Philippines with a singular, unwavering mission: to democratize digital solutions for everyone. We believe technology should serve the people, not exploit them.
            </p>

            <p className="text-[21px] text-white/80 leading-relaxed">
              In an era where users are commoditized and data is harvested for the highest bidder, we stand apart. We reject the surveillance economy. We refuse to leech off your identity or clutter your experience with ads. At Anryh, we do not chase profit at the expense of your privacy. We put humans first through protecting your data, respecting your dignity, and building a digital future that belongs to you.
            </p>
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
            <Link href="/write" className="hover:text-white transition-colors">Help</Link>
            <Link href="/status" className="hover:text-white transition-colors">Status</Link>
            <Link href="/careers" className="hover:text-white transition-colors">Careers</Link>
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
