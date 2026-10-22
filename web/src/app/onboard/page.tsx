"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorCard, Logo, PrivacyNote, Spinner } from "@/components/flock";
import { supabase } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";

export default function OnboardPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [github, setGithub] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase().auth.getUser().then(({ data }) => {
      if (!data.user) router.replace("/login");
      else setEmail(data.user.email ?? null);
    });
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase().rpc("onboard", { p_first_name: firstName, p_github: github || null });
      if (error) throw error;
      // Trust signals (GitHub, Devpost, StopForumSpam) and the Zero follow-up run
      // server-side; neither may block onboarding.
      void fetch("/api/verify", { method: "POST" }).catch(() => undefined);
      void fetch("/api/zero", { method: "POST" }).catch(() => undefined);
      router.replace("/");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await supabase().auth.signOut();
    router.replace("/login");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-safe pb-safe">
      <div className="pt-10">
        <Logo size={30} />
      </div>
      <form onSubmit={submit} className="mt-10 flex flex-col gap-5">
        <div>
          <h1 className="text-[30px] leading-tight font-extrabold tracking-[-0.02em]">What should we call you?</h1>
          <p className="mt-2 text-[16px] text-muted">Matches only ever see your first name.</p>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="first" className="text-[13px] font-semibold text-muted">First name</label>
          <input
            id="first"
            required
            maxLength={40}
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="h-[52px] rounded-[14px] border border-line-strong bg-surface px-4 text-[16px] focus:border-amber focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="gh" className="text-[13px] font-semibold text-muted">GitHub username (optional)</label>
          <input
            id="gh"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="octocat"
            aria-describedby="gh-hint"
            value={github}
            onChange={(e) => setGithub(e.target.value.replace(/^@/, ""))}
            className="h-[52px] rounded-[14px] border border-line-strong bg-surface px-4 text-[16px] placeholder:text-muted/70 focus:border-amber focus:outline-none"
          />
          <p id="gh-hint" className="text-[13px] text-muted">Adds trust reasons like “GitHub since 2019”.</p>
        </div>
        {error && <ErrorCard message={error} />}
        <Button type="submit" disabled={busy || !firstName.trim()}>
          {busy ? <Spinner /> : <ArrowRight aria-hidden="true" />} Join Flock
        </Button>
        <PrivacyNote>
          Signed in as {email ?? "…"}. Your email is never shown to anyone.{" "}
          <button type="button" onClick={signOut} className="font-semibold text-text underline underline-offset-4">Not you?</button>
        </PrivacyNote>
      </form>
    </main>
  );
}
