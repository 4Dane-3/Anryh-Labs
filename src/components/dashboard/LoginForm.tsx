"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, MailCheck } from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import { Button, Label, inputClass } from "@/components/dashboard/ui";

export function LoginForm({ linkError }: { linkError: boolean }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(
    linkError ? "That sign-in link expired or was already used. Request a new one." : null,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowser();

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setBusy(false);
    if (error) {
      setError("We couldn't send a link to that email. Check it's the one your account uses.");
      return;
    }
    setSent(true);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="w-full max-w-sm"
    >
      <div className="mb-8">
        <div className="mb-6 flex size-9 items-center justify-center rounded-lg bg-brand text-sm font-bold text-brand-fg">
          A
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Sign in to your dashboard</h1>
        <p className="mt-1 text-sm text-fg-muted">Enter your email and we&apos;ll send you a link. No password.</p>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {sent ? (
          <motion.div
            key="sent"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-line bg-ink-raised p-5"
          >
            <MailCheck className="size-5 text-brand" />
            <p className="mt-3 text-sm font-medium">Check your email</p>
            <p className="mt-1 text-[13px] text-fg-muted">
              We sent a sign-in link to <span className="text-fg">{email}</span>. It works once and
              expires in an hour.
            </p>
            <Button variant="ghost" size="sm" className="mt-4 -ml-3" onClick={() => setSent(false)}>
              Use a different email
            </Button>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            onSubmit={submit}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            <div>
              <Label htmlFor="email">Email</Label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                className={inputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {error && <p className="text-[13px] text-bad">{error}</p>}

            <Button type="submit" variant="primary" disabled={busy} className="w-full">
              {busy ? <Loader2 className="animate-spin" /> : "Email me a sign-in link"}
            </Button>

            <p className="text-center text-[13px] text-fg-faint">No password needed. We email you a link that signs you in.</p>
          </motion.form>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
