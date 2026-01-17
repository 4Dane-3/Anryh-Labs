"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ExternalLink } from "lucide-react";

const companies = [
  {
    id: "clync-allo",
    name: "Clync-Allo",
    description: "Clync is a local-first AI desktop app that cleans, classifies, and fixes documents before they hit your local file system.\n\nClync-Allo Enterprise provides cloud and CRM organization, helping businesses eliminate digital clutter and improve file efficiency.",
    status: "Active",
    href: "https://clync.me",
    logo: "/clync-logo.png",
    external: true,
  },
  {
    id: "dexrolo",
    name: "Dexrolo",
    description:
      "The pure networking app. Snap a selfie to establish a connection and be able to communicate directly. Ping an interest in meeting to 2nd connections and select meeting locations from the app.",
    status: "Pending",
    logo: "/favicon.svg",
    external: false,
  },
  // More companies will be added here
];

export default function CompaniesPage() {
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
            <Link href="/companies" className="text-sm text-white hover:text-white transition-colors hidden md:block">
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
              Companies
            </h1>
            <p className="text-[21px] text-white/70 max-w-2xl">
              Ventures built under Anryh Labs. Human-first technologies designed to serve people.
            </p>
          </motion.div>

          {/* Companies Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {companies.map((company, index) => (
              <motion.div
                key={company.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
              >
                {company.href ? (
                  <a
                    href={company.href}
                    target={company.external ? "_blank" : undefined}
                    rel={company.external ? "noopener noreferrer" : undefined}
                  >
                    <Card className="p-6 bg-white/5 border-white/10 hover:bg-white/10 transition-all cursor-pointer group h-full">
                      <div className="flex items-start justify-between mb-4">
                        <div className="p-2 bg-white/10 rounded-xl overflow-hidden">
                          <Image
                            src={company.logo}
                            alt={`${company.name} logo`}
                            width={32}
                            height={32}
                            className="w-8 h-8 object-contain"
                          />
                        </div>
                        <span className="text-xs px-2 py-1 bg-green-500/10 text-green-400 rounded-full">
                          {company.status}
                        </span>
                      </div>
                      <h3 className="font-manifold text-2xl font-semibold text-white mb-2 group-hover:text-white transition-colors">
                        {company.name}
                      </h3>
                      <p className="text-white/60 text-sm leading-relaxed mb-4 whitespace-pre-line">
                        {company.description}
                      </p>
                      <div className="flex items-center text-orange-400 text-sm font-medium group-hover:gap-2 transition-all">
                        <span>Visit Website</span>
                        <ExternalLink className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                      </div>
                    </Card>
                  </a>
                ) : (
                  <Card className="p-6 bg-white/5 border-white/10 transition-all h-full pending-pulse">
                    <div className="flex items-start justify-between mb-4">
                      <div className="p-2 bg-white/10 rounded-xl overflow-hidden">
                        <Image 
                          src={company.logo} 
                          alt={`${company.name} logo`}
                          width={32}
                          height={32}
                          className="w-8 h-8 object-contain"
                        />
                      </div>
                      <span className="text-xs px-2 py-1 bg-white/10 text-white/60 rounded-full">
                        {company.status}
                      </span>
                    </div>
                    <h3 className="font-manifold text-2xl font-semibold text-white mb-2 group-hover:text-white transition-colors">
                      {company.name}
                    </h3>
                    <p className="text-white/60 text-sm leading-relaxed mb-4 whitespace-pre-line">
                      {company.description}
                    </p>
                    <div className="flex items-center text-orange-400 text-sm font-medium">
                      <span>Coming soon...</span>
                      <ExternalLink className="w-4 h-4 ml-1 opacity-0" />
                    </div>
                  </Card>
                )}
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
              More ventures coming soon. Building human-first technologies, one company at a time.
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
