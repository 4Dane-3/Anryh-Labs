"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { BackgroundPaths } from "@/components/ui/background-paths";
import { submitWaitlistSignup } from "@/lib/waitlist";
import {
  Calculator,
  Type,
  Coins,
  CheckCircle,
  AlertCircle,
  Loader2,
  ArrowRight,
} from "lucide-react";

const features = [
  {
    icon: Calculator,
    title: "Math Duel",
    tagline: "Race to the answer.",
    description:
      "Same problem, same clock. Whoever solves it first takes the round.",
    accent: "text-orange-400",
    iconBg: "bg-orange-500/10",
  },
  {
    icon: Type,
    title: "Alphabet",
    tagline: "Race to the word.",
    description:
      "Two letters. One valid word. First to type it wins — dictionary doesn't lie.",
    accent: "text-orange-400",
    iconBg: "bg-orange-500/10",
  },
  {
    icon: Coins,
    title: "Stake Every Match",
    tagline: "Put coins on the line.",
    description:
      "Bet before you play. Win the duel, take the pot. Lose, and feel it.",
    accent: "text-orange-400",
    iconBg: "bg-orange-500/10",
  },
];

export default function PairoPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("submitting");

    try {
      await submitWaitlistSignup(email.trim());
      setStatus("success");
      setEmail("");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-black overflow-hidden">
      <header className="relative z-20 w-full border-b border-white/10">
        <div className="mx-auto flex h-[75px] max-w-[1336px] items-center justify-between px-6">
          <Link
            href="/"
            className="text-[28px] font-manifold font-bold tracking-tight text-white"
          >
            Anryh Labs
          </Link>
          <span className="text-sm text-white/40 hidden sm:block">
            A game from Anryh Labs
          </span>
        </div>
      </header>

      <main className="relative flex-1">
        <div className="absolute inset-0 z-0">
          <BackgroundPaths />
        </div>

        {/* Hero */}
        <section className="relative z-10 mx-auto max-w-[1336px] px-6 pt-20 pb-16 md:pt-28 md:pb-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-[800px]"
          >
            <p className="text-sm font-medium text-orange-400 mb-4 tracking-wide uppercase">
              Coming soon
            </p>
            <h1 className="font-manifold text-[56px] md:text-[80px] leading-[0.95] tracking-[-0.02em] text-white mb-6">
              Mini-games.
              <br />
              Real stakes.
              <br />
              <span className="text-white/50">Your friends.</span>
            </h1>
            <p className="text-[21px] text-white/70 max-w-[560px] mb-2">
              Pairo is head-to-head duels with friends — fast, real-time, and
              worth betting on.
            </p>
            <p className="text-[18px] text-white/50 max-w-[520px]">
              Stake coins before every match. Win the round, take the pot.
            </p>
          </motion.div>
        </section>

        {/* Features */}
        <section className="relative z-10 mx-auto max-w-[1336px] px-6 pb-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mb-10"
          >
            <h2 className="font-manifold text-[36px] md:text-[48px] leading-[1.05] tracking-[-0.02em] text-white">
              What is Pairo?
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.15 + index * 0.1 }}
              >
                <Card className="p-6 bg-white/5 border-white/10 h-full">
                  <div
                    className={`p-3 ${feature.iconBg} rounded-xl w-fit mb-4`}
                  >
                    <feature.icon className={`w-6 h-6 ${feature.accent}`} />
                  </div>
                  <h3 className="font-manifold text-2xl font-semibold text-white mb-1">
                    {feature.title}
                  </h3>
                  <p className={`text-sm font-medium ${feature.accent} mb-3`}>
                    {feature.tagline}
                  </p>
                  <p className="text-white/60 text-sm leading-relaxed">
                    {feature.description}
                  </p>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Waitlist */}
        <section className="relative z-10 mx-auto max-w-[1336px] px-6 pb-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="max-w-[560px] mx-auto"
          >
            <div className="text-center mb-8">
              <h2 className="font-manifold text-[36px] md:text-[48px] leading-[1.05] tracking-[-0.02em] text-white mb-3">
                Get early access
              </h2>
              <p className="text-[18px] text-white/60">
                Be first in line when Pairo drops. No spam, just the launch.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="sr-only">
                  Email address
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@email.com"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={status === "submitting"}
                className="w-full flex items-center justify-center gap-2 h-[52px] bg-white text-black text-[16px] font-medium rounded-xl hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === "submitting" ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Joining...
                  </>
                ) : (
                  <>
                    Join the waitlist
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>

              {status === "success" && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 text-green-400 justify-center text-sm"
                >
                  <CheckCircle className="w-5 h-5 shrink-0" />
                  <span>You&apos;re on the list. We&apos;ll be in touch.</span>
                </motion.div>
              )}

              {status === "error" && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 text-red-400 justify-center text-sm"
                >
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <span>
                    Something went wrong. Try again in a moment.
                  </span>
                </motion.div>
              )}
            </form>

            <p className="text-center text-white/40 text-sm mt-8">
              Pairo is built by{" "}
              <Link
                href="/"
                className="text-white/60 hover:text-white transition-colors underline"
              >
                Anryh Labs
              </Link>
            </p>
          </motion.div>
        </section>
      </main>

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
