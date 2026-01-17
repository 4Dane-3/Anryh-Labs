"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FileVideo, ArrowRight } from "lucide-react";

const apps = [
  {
    id: "file-converter",
    name: "File Converter",
    description: "Convert video, audio, and image files between different formats instantly in your browser. 100% private - files never leave your computer.",
    status: "Available",
    href: "/open-source-apps/file-converter",
    icon: FileVideo,
  },
  // More apps will be added here
];

export default function OpenSourceAppsPage() {
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
            <Link href="/open-source-apps" className="text-sm text-white hover:text-white transition-colors hidden sm:block">
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
        <div className="mx-auto max-w-[1336px] px-6 py-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-12"
          >
            <h1 className="font-manifold text-[60px] md:text-[80px] leading-[0.95] tracking-[-0.02em] text-white mb-6">
              Open-Sourced Apps
            </h1>
            <p className="text-[21px] text-white/70 max-w-2xl">
              A collection of free, open-source applications. All apps are completely free to use.
            </p>
          </motion.div>

          {/* Apps Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {apps.map((app, index) => (
              <motion.div
                key={app.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
              >
                <Link href={app.href}>
                  <Card className="p-6 bg-white/5 border-white/10 hover:bg-white/10 transition-all cursor-pointer group h-full">
                    <div className="flex items-start justify-between mb-4">
                      <div className="p-3 bg-blue-500/10 rounded-xl">
                        <app.icon className="w-6 h-6 text-blue-400" />
                      </div>
                      <span className="text-xs px-2 py-1 bg-green-500/10 text-green-400 rounded-full">
                        {app.status}
                      </span>
                    </div>
                    <h3 className="font-manifold text-2xl font-semibold text-white mb-2 group-hover:text-white transition-colors">
                      {app.name}
                    </h3>
                    <p className="text-white/60 text-sm leading-relaxed mb-4">
                      {app.description}
                    </p>
                    <div className="flex items-center text-blue-400 text-sm font-medium group-hover:gap-2 transition-all">
                      <span>Open App</span>
                      <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </Card>
                </Link>
              </motion.div>
            ))}
          </div>

          {/* Coming Soon Message */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-16 text-center"
          >
            <p className="text-white/40 text-sm">
              More apps coming soon. All apps are built completely free and open-source.
            </p>
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
