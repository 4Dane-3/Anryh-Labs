"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function CareersPage() {
  return (
    <div className="min-h-screen flex flex-col bg-black">
      {/* Header */}
      <header className="relative z-20 w-full border-b border-white/10">
        <div className="mx-auto flex h-[75px] max-w-[1336px] items-center justify-between px-6">
          <Link href="/" className="text-[28px] font-manifold font-bold tracking-tight text-white">
            Anryh Labs
          </Link>
          
          <nav className="flex items-center gap-6">
            <Link href="/our-story" className="text-sm text-white/70 hover:text-white transition-colors hidden sm:block">
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
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-2xl"
        >
          <h1 className="font-manifold text-[64px] md:text-[80px] leading-[1] tracking-[-0.02em] text-white mb-8">
            Careers
          </h1>
          
          <p className="text-[32px] md:text-[40px] text-white/80 font-light mb-8">
            Not hiring.
          </p>
          
          <p className="text-white/50 text-lg">
            But send our founder an email just in case{" "}
            <a 
              href="mailto:dane@clync.me" 
              className="text-orange-400 hover:text-orange-300 underline transition-colors"
            >
              dane@clync.me
            </a>
          </p>
        </motion.div>
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
