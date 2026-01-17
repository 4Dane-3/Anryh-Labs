"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { RotatingGlobe } from "@/components/RotatingGlobe";
import { BackgroundPaths } from "@/components/ui/background-paths";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-black overflow-hidden">
      {/* Header */}
      <header className="relative z-20 w-full border-b border-white/10">
        <div className="mx-auto flex h-[75px] max-w-[1336px] items-center justify-between px-6">
          <a href="/" className="text-[28px] font-manifold font-bold tracking-tight text-white">
            Anryh Labs
          </a>
          
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
              <button className="h-[38px] px-4 bg-white text-black text-sm font-normal rounded-full hover:bg-white/90 transition-colors">
                Get started
              </button>
            </nav>
        </div>
      </header>
      
      {/* Hero Section */}
      <main className="relative flex-1 flex items-center">
        {/* Background Paths - lowest layer */}
        <div className="absolute inset-0 z-0">
          <BackgroundPaths />
        </div>
        
        {/* Globe - positioned to the right, partially off-screen */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.3 }}
          className="absolute right-[-150px] top-1/2 -translate-y-1/2 w-[700px] h-[700px] z-5 hidden lg:block"
        >
          {/* Circular black background matching globe sphere */}
          <div 
            className="absolute inset-0"
            style={{
              background: 'radial-gradient(circle at 50% 50%, black 0%, black 39.5%, transparent 40%)'
            }}
          />
          <div className="relative w-full h-full">
            <RotatingGlobe />
          </div>
        </motion.div>
        
        <div className="relative z-10 mx-auto max-w-[1336px] w-full px-6">
          <div className="flex items-center justify-between gap-8">
            {/* Left - Text Content */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="max-w-[650px]"
            >
              <h1 className="font-manifold text-[60px] md:text-[80px] leading-[0.95] tracking-[-0.02em] text-white mb-8">
                Human-first<br />
                Technologies
              </h1>
              <p className="text-[21px] text-white/70 mb-8 font-normal">
                Thoughtfully engineered tools built to serve people, not extract from them.
              </p>
              <Link 
                href="/companies"
                className="inline-flex items-center justify-center h-[46px] px-6 bg-white text-black text-[20px] font-normal rounded-full hover:bg-white/90 transition-colors"
              >
                Companies
              </Link>
            </motion.div>
          </div>
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
