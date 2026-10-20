"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, MailCheck } from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import { Button, Label, inputClass } from "@/components/dashboard/ui";

export function LoginForm({ linkError }: { linkError: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "link">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

    if (mode === "password") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError("That email and password don't match an account.");
        setBusy(false);
        return;
      }
      router.replace("/dashboard");
      router.refresh();
      return;
    }

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
        <p className="mt-1 text-sm text-fg-muted">Your ads, calendar and clients in one place.</p>
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

            <AnimatePresence initial={false}>
              {mode === "password" && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <Label htmlFor="password">Password</Label>
                  <input
                    id="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    className={inputClass}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {error && <p className="text-[13px] text-bad">{error}</p>}

            <Button type="submit" variant="primary" disabled={busy} className="w-full">
              {busy ? (
                <Loader2 className="animate-spin" />
              ) : mode === "password" ? (
                "Sign in"
              ) : (
                "Email me a sign-in link"
              )}
            </Button>

            <button
              type="button"
              onClick={() => {
                setMode(mode === "password" ? "link" : "password");
                setError(null);
              }}
              className="w-full text-center text-[13px] text-fg-muted transition-colors hover:text-fg"
            >
              {mode === "password" ? "Forgot your password? Get a sign-in link" : "Sign in with a password"}
            </button>
          </motion.form>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
