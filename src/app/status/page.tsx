"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";

export default function StatusPage() {
  return (
    <div className="min-h-screen flex flex-col bg-black">
      <header className="relative z-20 w-full border-b border-white/10">
        <div className="mx-auto flex h-[75px] max-w-[1336px] items-center justify-between px-6">
          <Link
            href="/"
            className="text-[28px] font-manifold font-bold tracking-tight text-white"
          >
            anryh labs
          </Link>

          <nav className="flex items-center gap-6">
            <Link
              href="/write"
              className="text-sm text-white/70 hover:text-white transition-colors hidden md:block"
            >
              write
            </Link>
            <Button className="h-[38px] px-4 bg-white text-black text-sm font-normal rounded-full hover:bg-white/90 transition-colors">
              get started
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="flex flex-col md:flex-row items-center gap-12 max-w-4xl">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
            className="flex-1 text-center md:text-left"
          >
            <h1 className="font-manifold text-[48px] md:text-[56px] leading-[1.1] tracking-[-0.02em] text-white mb-6">
              status
            </h1>
            <div className="space-y-4 text-white/70 text-lg">
              <p>if you&apos;re seeing this, the website is working.</p>
              <p>
                if you are on this site and can&apos;t see anything, you are
                simply blind.
              </p>
              <p className="pt-4">
                <a
                  href="https://stores.warbyparker.com/wa/seattle/2619-ne-university-village-st/exam"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-orange-400 hover:text-orange-300 underline transition-colors"
                >
                  eye doctor for you.
                </a>
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="flex-shrink-0"
          >
            <Image
              src="/cat-underwater.gif"
              alt="cat underwater"
              width={300}
              height={300}
              className="rounded-2xl"
              unoptimized
            />
          </motion.div>
        </div>
      </main>

      <footer className="relative z-20 border-t border-white/10 py-6">
        <div className="mx-auto max-w-[1336px] px-6">
          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-white/40">
            <Link href="/write" className="hover:text-white transition-colors">
              help
            </Link>
            <Link href="/status" className="hover:text-white transition-colors">
              status
            </Link>
            <Link
              href="/careers"
              className="hover:text-white transition-colors"
            >
              careers
            </Link>
            <Link
              href="/privacy"
              className="hover:text-white transition-colors"
            >
              privacy
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
