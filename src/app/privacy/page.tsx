"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function PrivacyPage() {
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
              Privacy Policy
            </h1>
            <p className="text-white/40 mb-12">Effective Date: 01/01/2026</p>

            <div className="space-y-10 text-white/80 leading-relaxed">
              {/* Section 1 */}
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  1. Our Core Philosophy: You Are Not the Product
                </h2>
                <p>
                  This policy explains how Anryh Labs handles your data. Unlike most tech companies, our business model does not rely on surveillance, advertising, or data retention. Our aim is not just to comply with privacy laws, but to set a new standard for digital dignity. We do not want your data. We do not store your data. We exist to serve you, not to study you.
                </p>
              </section>

              {/* Section 2 */}
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  2. Information We Do Not Collect
                </h2>
                <p className="mb-4">To be explicitly clear:</p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>We do not collect your personal browsing history.</li>
                  <li>We do not collect your IP address for tracking or analytics.</li>
                  <li>We do not sell, trade, or mine your data for marketing.</li>
                  <li>We do not use cookies to follow you across the internet.</li>
                </ul>
              </section>

              {/* Section 3 */}
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  3. Ephemeral Data Processing (The "Use and Destroy" Policy)
                </h2>
                <p className="mb-4">
                  When you use our open-source applications or tools, you may submit data (such as a file to be converted, text to be edited, or code to be processed).
                </p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li><strong className="text-white">Processing:</strong> Your data is processed solely for the purpose of performing the specific task you requested.</li>
                  <li><strong className="text-white">Immediate Deletion:</strong> Once the task is complete (e.g., the file is converted), the data is immediately and permanently deleted from our active memory.</li>
                  <li><strong className="text-white">No Logs:</strong> We do not maintain server logs of the content of your submissions.</li>
                </ul>
              </section>

              {/* Section 4 */}
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  4. Open Source Transparency
                </h2>
                <p>
                  Trust is earned through verification, not promises. Many of our core tools are Open Source. We invite the technical community to audit our code repositories to verify that our data deletion protocols function exactly as described. We have nothing to hide because we hold nothing back.
                </p>
              </section>

              {/* Section 5 */}
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  5. Third-Party Embeds & Services
                </h2>
                <p className="mb-4">
                  Anryh Labs operates with minimal third-party dependencies. However, some strictly necessary infrastructure (like hosting providers) is required to keep the lights on.
                </p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li><strong className="text-white">Hosting:</strong> We use Vercel to host our infrastructure. While traffic passes through their servers, we configure our applications to prevent persistent logging of user activity.</li>
                  <li><strong className="text-white">No External Analytics:</strong> We do not use Google Analytics, Facebook Pixels, or third-party trackers.</li>
                </ul>
              </section>

              {/* Section 6 */}
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  6. Cookies & Local Storage
                </h2>
                <p className="mb-4">We do not use tracking cookies.</p>
                <p>
                  <strong className="text-white">Functional Only:</strong> We may use "Local Storage" on your specific device to save your preferences (like "Dark Mode"). This data never leaves your device and is never sent to Anryh Labs. If you clear your browser cache, this setting is reset.
                </p>
              </section>

              {/* Section 7 */}
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  7. Data Security
                </h2>
                <p>
                  We use industry-standard encryption (HTTPS/TLS) to protect data while it is in transit between your device and our processing servers. However, our strongest security feature is our retention policy: The safest data is data that does not exist. By deleting your data immediately after processing, we eliminate the risk of leaks, hacks, or subpoenas exposing your information.
                </p>
              </section>

              {/* Section 8 */}
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  8. Government Requests
                </h2>
                <p>
                  Because we do not store user data, logs, or files, we cannot produce them. If Anryh Labs receives a legal request or subpoena for user data, our response will be truthful and consistent: We have no data to provide.
                </p>
              </section>

              {/* Section 9 */}
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  9. Changes to this Policy
                </h2>
                <p>
                  We may update this policy to clarify our practices or comply with new regulations. If we make significant changes, we will notify users through our website. The most current version will always be available here.
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
