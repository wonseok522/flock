"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, Footprints, LogOut, Phone, Search, ShieldCheck, Stethoscope, Timer, TrainFront, UserRound } from "lucide-react";
import { Screen, ScreenTitle } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, ErrorCard, Eyebrow, FallbackLabel, Skeleton, Spinner } from "@/components/flock";
import { supabase } from "@/lib/supabase/client";
import { useMember } from "@/lib/use-member";
import { friendlyError } from "@/lib/errors";
import type { Active } from "@/lib/types";

// Safety tab: 999 first, then non-emergency numbers, the university contacts
// from the community's Notion Safety Rules page (via /api/contacts), your
// active walk or timer (Supabase my_active), and the safety rules.

type Contact = { name: string; detail: string };
type ContactsState =
  | { status: "loading" }
  | { status: "ready"; source: "notion" | "fallback"; contacts: Contact[] }
  | { status: "error" };

const PHONE = /(\+?\d[\d\s()-]{6,}\d)/;

function telHref(raw: string): string {
  return `tel:${raw.replace(/[^\d+]/g, "")}`;
}

function ContactRow({ c }: { c: Contact }) {
  const phone = c.detail.match(PHONE)?.[1] ?? c.name.match(PHONE)?.[1];
  return (
    <li className="flex min-h-[60px] items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-bold">{c.name}</p>
        {c.detail && <p className="text-[14px] break-words text-muted">{c.detail}</p>}
      </div>
      {phone && (
        <Button asChild variant="chip" size="sm">
          <a href={telHref(phone)} aria-label={`Call ${c.name}`}>
            <Phone aria-hidden="true" /> Call
          </a>
        </Button>
      )}
    </li>
  );
}

function ActiveRow({ a }: { a: Active }) {
  const info =
    a.kind === "match"
      ? { href: `/walk/${a.id}`, title: "Your walk home", body: "Check in when you're home.", Icon: Footprints }
      : a.kind === "solo"
        ? { href: `/solo/${a.id}`, title: "Your solo check-in", body: "Open the timer.", Icon: Timer }
        : { href: `/sessions/${a.session_id}/walk`, title: "Looking for a walk buddy", body: "We'll show people as they join.", Icon: Search };
  const { Icon } = info;
  return (
    <Link href={info.href} className="flex min-h-[64px] items-center gap-3 rounded-[18px] border border-safe bg-safe-tint px-4 py-3 active:opacity-90">
      <Icon className="size-5 shrink-0 text-safe" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-extrabold">{info.title}</span>
        <span className="block text-[14px] text-muted">{info.body}</span>
      </span>
      <ArrowRight className="size-5 shrink-0 text-safe" aria-hidden="true" />
    </Link>
  );
}

export function SafetyScreen() {
  const router = useRouter();
  const me = useMember();
  const ready = me.status === "ready";
  const [contacts, setContacts] = useState<ContactsState>({ status: "loading" });
  const [contactsNonce, setContactsNonce] = useState(0);
  const [active, setActive] = useState<Active[] | null>(null);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [activeNonce, setActiveNonce] = useState(0);
  const [signingOut, setSigningOut] = useState(false);

  // University contacts: public safety info, so no sign-in needed to load them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/contacts", { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { source: "notion" | "fallback"; contacts: Contact[] };
        if (!cancelled) setContacts({ status: "ready", source: body.source, contacts: body.contacts ?? [] });
      } catch {
        if (!cancelled) setContacts({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contactsNonce]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase().rpc("my_active");
        if (error) throw error;
        if (!cancelled) {
          setActive((data ?? []) as Active[]);
          setActiveError(null);
        }
      } catch (e) {
        if (!cancelled) setActiveError(friendlyError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, activeNonce]);

  async function signOut() {
    setSigningOut(true);
    try {
      await supabase().auth.signOut();
    } finally {
      router.replace("/login");
    }
  }

  // No full-screen loading state: 999 must be on screen immediately.
  return (
    <Screen>
      <ScreenTitle sub="Who to call, your walk, and how Flock keeps you safe.">Safety</ScreenTitle>

      {/* 999 first, always. */}
      <section className="flex flex-col gap-3 rounded-[24px] border border-danger bg-danger-surface p-5">
        <h2 className="text-[24px] leading-tight font-extrabold tracking-[-0.02em]">In danger? Call 999 first.</h2>
        <Button asChild variant="danger" className="h-[64px] rounded-[20px] text-[20px]">
          <a href="tel:999">
            <Phone className="size-6" aria-hidden="true" /> Call 999
          </a>
        </Button>
        <p className="text-[14px] text-danger-soft">Police, ambulance or fire. Then tell your group with SOS.</p>
      </section>

      <section aria-labelledby="nonemerg-h" className="flex flex-col gap-2">
        <Eyebrow>
          <span id="nonemerg-h">Not an emergency</span>
        </Eyebrow>
        <div className="grid grid-cols-2 gap-3">
          <Button asChild variant="secondary" size="md" className="h-auto min-h-[64px] flex-col gap-0.5 py-2">
            <a href="tel:101" aria-label="Call police non-emergency 101">
              <span className="flex items-center gap-1.5 text-[15px]">
                <ShieldCheck className="size-4" aria-hidden="true" /> Police
              </span>
              <span className="font-mono text-[20px] text-amber">101</span>
            </a>
          </Button>
          <Button asChild variant="secondary" size="md" className="h-auto min-h-[64px] flex-col gap-0.5 py-2">
            <a href="tel:111" aria-label="Call NHS 111">
              <span className="flex items-center gap-1.5 text-[15px]">
                <Stethoscope className="size-4" aria-hidden="true" /> NHS
              </span>
              <span className="font-mono text-[20px] text-amber">111</span>
            </a>
          </Button>
        </div>
      </section>

      <section aria-labelledby="uni-h" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow>
            <span id="uni-h">Your university&apos;s security and welfare contacts</span>
          </Eyebrow>
        </div>
        {contacts.status === "loading" ? (
          <div className="flex flex-col gap-2" role="status" aria-label="Loading contacts">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : contacts.status === "ready" && contacts.source === "notion" ? (
          <>
            <ul className="overflow-hidden rounded-[18px] border border-line bg-surface">
              {contacts.contacts.map((c, i) => (
                <ContactRow key={`${c.name}-${i}`} c={c} />
              ))}
            </ul>
            <p className="flex items-center gap-1.5 text-[13px] text-muted">
              <BookOpen className="size-4" aria-hidden="true" /> From your society&apos;s Safety Rules in Notion
            </p>
          </>
        ) : (
          <Card className="flex flex-col gap-2">
            <div>
              <FallbackLabel>Offline copy</FallbackLabel>
            </div>
            <p className="text-[16px] font-semibold">Ask your society for your university security number.</p>
            <p className="text-[14px] text-muted">We couldn&apos;t load the contacts from your society&apos;s Safety Rules page right now.</p>
            <Button variant="text" size="sm" className="w-fit px-0" onClick={() => {
              setContacts({ status: "loading" });
              setContactsNonce((n) => n + 1);
            }}>
              Try again
            </Button>
          </Card>
        )}
      </section>

      <section aria-labelledby="active-h" className="flex flex-col gap-2">
        <Eyebrow>
          <span id="active-h">Your walk tonight</span>
        </Eyebrow>
        {me.status === "error" ? (
          <ErrorCard message={me.message} onRetry={me.reload} />
        ) : activeError ? (
          <ErrorCard message={activeError} onRetry={() => setActiveNonce((n) => n + 1)} />
        ) : active === null ? (
          <Skeleton className="h-16" />
        ) : active.length === 0 ? (
          <div className="flex flex-col gap-3 rounded-[18px] border border-dashed border-line-strong p-4">
            <p className="text-[15px] text-muted">No walk or timer running.</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary" size="sm">
                <Link href="/sessions">
                  <Footprints aria-hidden="true" /> Find a walk buddy
                </Link>
              </Button>
              <Button asChild variant="secondary" size="sm">
                <Link href="/solo/new">
                  <Timer aria-hidden="true" /> Solo check-in
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {active.map((a) => (
              <ActiveRow key={`${a.kind}-${a.id}`} a={a} />
            ))}
          </div>
        )}
      </section>

      <Card className="flex flex-col gap-3">
        <Eyebrow>How Flock keeps you safe</Eyebrow>
        <ul className="flex flex-col gap-2.5 text-[15px]">
          <li className="flex items-start gap-2.5">
            <TrainFront className="mt-0.5 size-5 shrink-0 text-amber" aria-hidden="true" /> Stations only. We never ask for your home address.
          </li>
          <li className="flex items-start gap-2.5">
            <UserRound className="mt-0.5 size-5 shrink-0 text-amber" aria-hidden="true" /> First names only. No surnames, emails or numbers.
          </li>
          <li className="flex items-start gap-2.5">
            <Timer className="mt-0.5 size-5 shrink-0 text-amber" aria-hidden="true" /> Check in when you&apos;re home. Miss it and your group hears.
          </li>
          <li className="flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-amber" aria-hidden="true" /> Report anything that feels wrong. A human from your society reviews it.
          </li>
        </ul>
        <p className="rounded-[14px] bg-surface-2 px-3 py-2 text-[14px] font-semibold">A human decides. Grok Bot only recommends.</p>
      </Card>

      {me.status === "ready" && (
        <div className="flex flex-col gap-2">
          <p className="text-center text-[14px] text-muted">Signed in as {me.member.first_name}</p>
          <Button variant="secondary" onClick={signOut} disabled={signingOut}>
            {signingOut ? <Spinner /> : <LogOut aria-hidden="true" />} Sign out
          </Button>
        </div>
      )}
    </Screen>
  );
}
