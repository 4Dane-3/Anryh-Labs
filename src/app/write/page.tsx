"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Send, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

export default function WritePage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "",
    message: "",
  });
  const [status, setStatus] = useState<
    "idle" | "sending" | "success" | "error"
  >("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");

    try {
      const response = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          access_key: "596495f4-4571-4a20-8f4e-696c1cef154b",
          to: "dane@clync.me",
          from_name: formData.name,
          email: formData.email,
          subject: formData.subject || "New message from Anryh Labs",
          message: formData.message,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setStatus("success");
        setFormData({ name: "", email: "", subject: "", message: "" });
      } else {
        setStatus("error");
      }
    } catch (error) {
      setStatus("error");
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  return (
    <div className="min-h-screen flex flex-col bg-black">
      {/* Header */}
      <header className="relative z-20 w-full border-b border-white/10">
        <div className="mx-auto flex h-[75px] max-w-[1336px] items-center justify-between px-6">
          <Link
            href="/"
            className="text-[28px] font-manifold font-bold tracking-tight text-white"
          >
            Anryh Labs
          </Link>

          <nav className="flex items-center gap-6">
            <Link
              href="/our-story"
              className="text-sm text-white/70 hover:text-white transition-colors hidden sm:block"
            >
              Our story
            </Link>
            <Link
              href="/open-source-apps"
              className="text-sm text-white/70 hover:text-white transition-colors hidden sm:block"
            >
              Open-Sourced Apps
            </Link>
            <Link
              href="/companies"
              className="text-sm text-white/70 hover:text-white transition-colors hidden md:block"
            >
              Companies
            </Link>
            <Link
              href="/write"
              className="text-sm text-white hover:text-white transition-colors hidden md:block"
            >
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
        <div className="w-full max-w-[600px]">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-12"
          >
            <h1 className="font-manifold text-[48px] md:text-[64px] leading-[1.1] tracking-[-0.02em] text-white mb-4">
              Write to Us
            </h1>
            <p className="text-[18px] text-white/60">
              Have a question, idea, or just want to say hello? We'd love to
              hear from you.
            </p>
          </motion.div>

          <motion.form
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            onSubmit={handleSubmit}
            className="space-y-6"
          >
            {/* Name */}
            <div>
              <label
                htmlFor="name"
                className="block text-sm text-white/60 mb-2"
              >
                Your Name
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors"
                placeholder="John Doe"
              />
            </div>

            {/* Email */}
            <div>
              <label
                htmlFor="email"
                className="block text-sm text-white/60 mb-2"
              >
                Your Email
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors"
                placeholder="john@example.com"
              />
            </div>

            {/* Subject */}
            <div>
              <label
                htmlFor="subject"
                className="block text-sm text-white/60 mb-2"
              >
                Subject
              </label>
              <input
                type="text"
                id="subject"
                name="subject"
                value={formData.subject}
                onChange={handleChange}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors"
                placeholder="What's this about?"
              />
            </div>

            {/* Message */}
            <div>
              <label
                htmlFor="message"
                className="block text-sm text-white/60 mb-2"
              >
                Message
              </label>
              <textarea
                id="message"
                name="message"
                value={formData.message}
                onChange={handleChange}
                required
                rows={6}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors resize-none"
                placeholder="Write your message here..."
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full flex items-center justify-center gap-2 h-[52px] bg-white text-black text-[16px] font-medium rounded-xl hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === "sending" ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  Send Message
                </>
              )}
            </button>

            {/* Status Messages */}
            {status === "success" && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 text-green-400 justify-center"
              >
                <CheckCircle className="w-5 h-5" />
                <span>
                  Message sent successfully! We'll get back to you soon.
                </span>
              </motion.div>
            )}

            {status === "error" && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 text-red-400 justify-center"
              >
                <AlertCircle className="w-5 h-5" />
                <span>
                  Something went wrong. Please try again or email us directly.
                </span>
              </motion.div>
            )}
          </motion.form>

          {/* Alternative Contact */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="text-center text-white/40 text-sm mt-8"
          >
            Or email us directly at{" "}
            <a
              href="mailto:dane@clync.me"
              className="text-white/60 hover:text-white transition-colors underline"
            >
              dane@clync.me
            </a>
          </motion.p>
        </div>
      </main>

      {/* Footer */}
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
