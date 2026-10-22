"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorCard, Logo, PrivacyNote, Spinner } from "@/components/flock";
import { supabase } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";

// Client-side hint only. The real check is the onboard() RPC, which reads the
// email from auth.users and compares it with communities.allowed_email_domains.
function looksLikeUniversityEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return domain.endsWith(".ac.uk") || domain === "demo.flock.test";
}

export function LoginScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error"));

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const clean = email.trim().toLowerCase();
    if (!looksLikeUniversityEmail(clean)) {
      setError("Flock is for London university students. Use your university email (for example name@ucl.ac.uk).");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase().auth.signInWithOtp({
        email: clean,
        options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      });
      if (error) throw error;
      setEmail(clean);
      setStep("code");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error } = await supabase().auth.verifyOtp({ email, token: code.trim(), type: "email" });
      if (error) throw error;
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(/expired|invalid/i.test(friendlyError(err)) ? "That code didn't work. Check the latest email, or send a new code." : friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-safe pb-safe">
      <div className="pt-10">
        <Logo size={34} />
      </div>

      {step === "email" ? (
        <form onSubmit={sendCode} className="mt-auto flex flex-col gap-5 pb-4">
          <div>
            <h1 className="text-[34px] leading-[1.1] font-extrabold tracking-[-0.03em]">Study together.<br />Get home together.</h1>
            <p className="mt-3 text-[16px] text-muted">Verified walk-home buddies for London university students.</p>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="email" className="text-[13px] font-semibold text-muted">University email</label>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              placeholder="name@ucl.ac.uk"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-[52px] rounded-[14px] border border-line-strong bg-surface px-4 text-[16px] text-text placeholder:text-muted/70 focus:border-amber focus:outline-none"
            />
          </div>
          {error && <ErrorCard message={error} />}
          <Button type="submit" disabled={busy}>
            {busy ? <Spinner /> : <Mail aria-hidden="true" />} Send code
          </Button>
          <Button
            type="button"
            variant="text"
            size="md"
            onClick={() => {
              const clean = email.trim().toLowerCase();
              if (!looksLikeUniversityEmail(clean)) {
                setError("Enter your university email first, then your code.");
                return;
              }
              setError(null);
              setEmail(clean);
              setStep("code");
            }}
          >
            I already have a code
          </Button>
          <PrivacyNote>
            <ShieldCheck className="mr-1 inline size-4 text-safe" aria-hidden="true" />
            Only verified students get in. Matches only ever see your first name, and we use stations, never home addresses.
          </PrivacyNote>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-auto flex flex-col gap-5 pb-4">
          <button type="button" onClick={() => setStep("email")} className="inline-flex min-h-11 w-fit items-center gap-1 text-[15px] font-semibold text-muted">
            <ArrowLeft className="size-5" aria-hidden="true" /> Change email
          </button>
          <div>
            <h1 className="text-[30px] leading-tight font-extrabold tracking-[-0.02em]">Check your email</h1>
            <p className="mt-2 text-[16px] text-muted">
              We sent a sign-in code to <span className="font-semibold text-text">{email}</span>. Type it here, or tap the link in the email on this phone.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="code" className="text-[13px] font-semibold text-muted">Code from the email</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6,8}"
              maxLength={8}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="h-[60px] rounded-[14px] border border-line-strong bg-surface px-4 text-center font-mono text-[28px] tracking-[0.3em] text-text focus:border-amber focus:outline-none"
            />
          </div>
          {error && <ErrorCard message={error} />}
          <Button type="submit" disabled={busy || code.length < 6}>
            {busy ? <Spinner /> : null} Verify
          </Button>
          <Button type="button" variant="text" size="md" onClick={(e) => sendCode(e as unknown as React.FormEvent)} disabled={busy}>
            Send a new code
          </Button>
        </form>
      )}
    </main>
  );
}
