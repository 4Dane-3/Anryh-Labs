"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function TermsPage() {
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
      <main className="flex-1">
        <div className="mx-auto max-w-[800px] px-6 py-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="font-manifold text-[48px] md:text-[56px] leading-[1.1] tracking-[-0.02em] text-white mb-4">
              Terms of Service
            </h1>
            <p className="text-white/40 mb-12">Effective Date: 01/01/2026</p>

            <div className="space-y-10 text-white/80 leading-relaxed">
              {/* Section 1 */}
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  1. Our Promise to You
                </h2>
                <p>
                  Anryh Labs exists to build tools that serve people, not exploit them. All of our open-source applications are provided completely free of charge. We do not monetize your usage, your data, or your attention. There are no hidden fees, premium tiers designed to extract value, or features locked behind paywalls meant to frustrate you into paying.
                </p>
              </section>

              {/* Section 2 */}
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  2. Free Means Free
                </h2>
                <p className="mb-4">
                  When we say our tools are free, we mean it:
                </p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>No subscription fees</li>
                  <li>No advertisements</li>
                  <li>No data harvesting for profit</li>
                  <li>No artificial limitations to push you toward paid versions</li>
                  <li>No dark patterns or manipulative design</li>
                </ul>
              </section>

              {/* Section 3 */}
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  3. Use Our Tools Freely
                </h2>
                <p>
                  You are welcome to use our applications for personal, educational, or commercial purposes. We built these tools to help you, and we're happy when they do. There's no catch. There's no "gotcha" clause waiting for you in the fine print.
                </p>
              </section>

              {/* Section 4 */}
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  4. Your Data, Your Control
                </h2>
                <p>
                  Any files or data you submit to our tools are processed only to complete the task you requested. We don't store, analyze, or monetize your content. Once your task is complete, your data is gone. Please refer to our <Link href="/privacy" className="text-orange-400 hover:text-orange-300 underline">Privacy Policy</Link> for complete details.
                </p>
              </section>

              {/* Section 5 */}
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  5. No Warranty (But We Try Our Best)
                </h2>
                <p>
                  Our tools are provided "as is" without warranty of any kind. While we work hard to ensure reliability and quality, we cannot guarantee that our services will be uninterrupted, error-free, or suitable for every use case. Use them at your own discretion.
                </p>
              </section>

              {/* Section 6 */}
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  6. Limitation of Liability
                </h2>
                <p>
                  Anryh Labs and its contributors shall not be held liable for any damages arising from the use or inability to use our services. This includes, but is not limited to, loss of data, business interruption, or any other commercial damages.
                </p>
              </section>

              {/* Section 7 */}
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  7. Open Source Spirit
                </h2>
                <p>
                  Many of our tools are open source because we believe in transparency and community. You're free to inspect, modify, and contribute to our code. We welcome collaboration from developers who share our vision of human-first technology.
                </p>
              </section>

              {/* Section 8 */}
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  8. Changes to These Terms
                </h2>
                <p>
                  We may update these terms from time to time. When we do, we'll update the effective date at the top of this page. Continued use of our services after changes constitutes acceptance of the new terms.
                </p>
              </section>

              {/* Section 9 */}
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  9. Questions?
                </h2>
                <p>
                  If you have any questions about these terms, feel free to <Link href="/write" className="text-orange-400 hover:text-orange-300 underline">reach out to us</Link>. We're real humans and we're happy to help.
                </p>
              </section>
            </div>
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
