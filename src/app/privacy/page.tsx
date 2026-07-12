"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function PrivacyPage() {
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

      <main className="flex-1">
        <div className="mx-auto max-w-[800px] px-6 py-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="font-manifold text-[48px] md:text-[56px] leading-[1.1] tracking-[-0.02em] text-white mb-4">
              privacy policy
            </h1>
            <p className="text-white/40 mb-12">effective date: 07/11/2026</p>

            <div className="space-y-10 text-white/80 leading-relaxed">
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  1. our core philosophy: you are not the product
                </h2>
                <p>
                  this policy explains how anryh labs handles your data. we
                  build products we&apos;d actually use ourselves — starting
                  with pairo, our head-to-head mini-games app. unlike most tech
                  companies, our business model does not rely on advertising,
                  tracking, or selling your information. our aim is not just to
                  comply with privacy laws, but to collect as little as
                  possible and be clear about what we do keep.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  2. information we do not collect
                </h2>
                <p className="mb-4">to be explicitly clear:</p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>we do not collect your personal browsing history.</li>
                  <li>
                    we do not collect your IP address for tracking or analytics.
                  </li>
                  <li>
                    we do not sell, trade, or mine your data for marketing.
                  </li>
                  <li>
                    we do not use cookies to follow you across the internet.
                  </li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  3. information we do collect
                </h2>
                <p className="mb-4">
                  this website is intentionally minimal. we only collect data
                  when you choose to give it to us:
                </p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>
                    <strong className="text-white">pairo waitlist:</strong> if
                    you sign up for early access, we store your email address so
                    we can notify you when pairo launches. that&apos;s it — no
                    account, no profile, no behavioral tracking.
                  </li>
                  <li>
                    <strong className="text-white">contact form:</strong> if
                    you write to us, we receive your name, email, subject, and
                    message so we can respond. this is delivered to us by email
                    and used only to handle your inquiry.
                  </li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  4. how we use your information
                </h2>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>
                    waitlist emails are used only to send launch updates about
                    pairo.
                  </li>
                  <li>
                    contact form submissions are used only to read and reply to
                    your message.
                  </li>
                  <li>
                    we do not use your information for advertising, profiling,
                    or resale.
                  </li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  5. third-party services
                </h2>
                <p className="mb-4">
                  anryh labs operates with minimal third-party dependencies.
                  however, some infrastructure is required to keep the site and
                  waitlist running:
                </p>
                <ul className="list-disc list-inside space-y-2 ml-4">
                  <li>
                    <strong className="text-white">hosting:</strong> we use
                    vercel to host this website.
                  </li>
                  <li>
                    <strong className="text-white">waitlist storage:</strong>{" "}
                    pairo waitlist signups are stored in supabase.
                  </li>
                  <li>
                    <strong className="text-white">waitlist email:</strong> if
                    you join the pairo waitlist, a confirmation email may be
                    sent via resend.
                  </li>
                  <li>
                    <strong className="text-white">contact delivery:</strong>{" "}
                    messages from our contact form are delivered via web3forms.
                  </li>
                  <li>
                    <strong className="text-white">
                      no external analytics:
                    </strong>{" "}
                    we do not use google analytics, facebook pixels, or
                    third-party trackers.
                  </li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  6. cookies & local storage
                </h2>
                <p className="mb-4">we do not use tracking cookies.</p>
                <p>
                  <strong className="text-white">functional only:</strong> we
                  may use local storage on your device to save preferences. this
                  data never leaves your device and is never sent to anryh labs.
                  if you clear your browser cache, any local settings are reset.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  7. data security
                </h2>
                <p>
                  we use industry-standard encryption (https/tls) to protect
                  data in transit between your device and our services. we keep
                  collection narrow and retention purposeful: waitlist emails
                  exist only to notify you about pairo, and contact messages
                  exist only to support conversation with you.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  8. government requests
                </h2>
                <p>
                  if anryh labs receives a legal request for user data, we will
                  review it and respond truthfully based on what we actually
                  hold. today that is limited to waitlist email addresses and
                  contact form correspondence — nothing more.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  9. changes to this policy
                </h2>
                <p>
                  we may update this policy to clarify our practices or comply
                  with new regulations. if we make significant changes, we will
                  notify users through our website. the most current version
                  will always be available here.
                </p>
              </section>
            </div>
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
