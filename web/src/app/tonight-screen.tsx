"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { ArrowRight, Footprints, MapPin, Plus, Search, Timer } from "lucide-react";
import { Screen } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { AvatarStack, Card, EmptyState, ErrorCard, Eyebrow, LoadingScreen, Logo, PrivacyNote, Skeleton, TimeChip } from "@/components/flock";
import { useMember } from "@/lib/use-member";
import { relativeEnd } from "@/lib/format";
import type { Active, SessionOverview } from "@/lib/types";
import { EventRow, markJoined, useInterval, useNow, useRpc } from "./sessions/shared";

const SOON_MS = 12 * 60 * 60 * 1000; // "tonight" = ending in the next 12 hours
const NUDGE_MS = 15 * 60 * 1000; // X1: "Heading home?" when your session ends within 15 min

function greeting(now: number): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(new Date(now)));
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 18) return "Good afternoon";
  return "Good evening";
}

function ActiveBanner({ active }: { active: Active }) {
  const info =
    active.kind === "match"
      ? { href: `/walk/${active.id}`, title: "You're walking home", body: "Open your walk to check in when you're home.", Icon: Footprints }
      : active.kind === "solo"
        ? { href: `/solo/${active.id}`, title: "Your solo check-in is running", body: "Open the timer to check in or add time.", Icon: Timer }
        : { href: `/sessions/${active.session_id}/walk`, title: "Looking for a walk buddy", body: "We'll show people as they join.", Icon: Search };
  const { Icon } = info;
  return (
    <Link
      href={info.href}
      className="flex min-h-[72px] items-center gap-4 rounded-[22px] border border-safe bg-safe-tint p-4 active:opacity-90"
    >
      <span className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-safe text-safe-ink">
        <Icon className="size-5" aria-hidden="true" />
        <span className="absolute -top-0.5 -right-0.5 size-3 rounded-full border-2 border-safe-tint bg-safe motion-safe:animate-pulse" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-extrabold text-text">{info.title}</span>
        <span className="block text-[14px] text-muted">{info.body}</span>
      </span>
      <ArrowRight className="size-5 shrink-0 text-safe" aria-hidden="true" />
    </Link>
  );
}

function YourSessionCard({ s, now }: { s: SessionOverview; now: number }) {
  const msLeft = new Date(s.ends_at).getTime() - now;
  const nudge = msLeft <= NUDGE_MS;
  const count = Number(s.member_count);
  return (
    <Card highlight className="flex flex-col gap-4 rounded-[24px]">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>Your session</Eyebrow>
        <TimeChip>{relativeEnd(s.ends_at)}</TimeChip>
      </div>
      <div>
        {nudge ? (
          <>
            <h2 className="text-[26px] leading-tight font-extrabold tracking-[-0.02em]">Heading home?</h2>
            <p className="mt-1 text-[16px] font-semibold">{s.title}</p>
          </>
        ) : (
          <h2 className="text-[22px] leading-tight font-extrabold tracking-[-0.02em]">{s.title}</h2>
        )}
        {s.location_name && (
          <p className="mt-1 flex items-center gap-1.5 text-[15px] text-muted">
            <MapPin className="size-4 shrink-0" aria-hidden="true" /> {s.location_name}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <AvatarStack names={s.member_names} total={count} />
        <p className="text-[14px] text-muted">
          <span className="font-mono font-semibold text-text">{count}</span> {count === 1 ? "person" : "people"} in this session
        </p>
      </div>
      <div className="flex flex-col gap-2.5">
        <Button asChild>
          <Link href={`/sessions/${s.id}/walk`}>
            <Footprints aria-hidden="true" /> Find a walk buddy
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href={`/solo/new?session=${s.id}`}>
            <Timer aria-hidden="true" /> Set a solo check-in instead
          </Link>
        </Button>
      </div>
    </Card>
  );
}

export function TonightScreen() {
  const member = useMember();
  const ready = member.status === "ready";
  const sessions = useRpc<SessionOverview[]>("sessions_overview", null, ready);
  const active = useRpc<Active[]>("my_active", null, ready);
  const now = useNow();

  // Keep Tonight current while the app is open (new members, new walks).
  const { refresh: refreshSessions } = sessions;
  const { refresh: refreshActive } = active;
  const refreshAll = useCallback(() => {
    refreshSessions();
    refreshActive();
  }, [refreshSessions, refreshActive]);
  useInterval(refreshAll, 20_000, ready);

  const { mine, others } = useMemo(() => {
    if (sessions.state.status !== "ready") return { mine: null, others: [] as SessionOverview[] };
    const upcoming = sessions.state.data
      .filter((s) => new Date(s.ends_at).getTime() > now && new Date(s.ends_at).getTime() - now < SOON_MS)
      .sort((a, b) => new Date(a.ends_at).getTime() - new Date(b.ends_at).getTime());
    const m = upcoming.find((s) => s.joined) ?? null;
    return { mine: m, others: upcoming.filter((s) => s.id !== m?.id) };
  }, [sessions.state, now]);

  if (member.status === "loading") return <LoadingScreen />;
  if (member.status === "error") {
    return (
      <Screen>
        <TopBar />
        <ErrorCard message={member.message} onRetry={member.reload} />
      </Screen>
    );
  }

  const firstName = member.member.first_name;
  const current = active.state.status === "ready" ? pickActive(active.state.data) : null;
  const onJoined = (id: string, name: string) => {
    sessions.setData((rows) => markJoined(rows, id, name));
    sessions.refresh();
  };

  return (
    <Screen>
      <TopBar initial={firstName} />
      <header>
        <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.02em]">
          {greeting(now)}, {firstName}
        </h1>
        <p className="mt-1 text-[15px] text-muted">Study together. Get home together.</p>
      </header>

      {current && <ActiveBanner active={current} />}
      {active.state.status === "error" && <ErrorCard message={`Couldn't check for a walk in progress. ${active.state.message}`} onRetry={active.retry} />}

      {sessions.state.status === "loading" ? (
        <div className="flex flex-col gap-4" role="status" aria-live="polite">
          <span className="sr-only">Loading tonight&apos;s sessions…</span>
          <Skeleton className="h-64 rounded-[24px]" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : sessions.state.status === "error" ? (
        <ErrorCard message={sessions.state.message} onRetry={sessions.retry} />
      ) : !mine && others.length === 0 ? (
        <EmptyState
          title="No sessions tonight yet"
          body="Start one so people studying with you can get home together."
          action={
            <div className="flex flex-col gap-2.5">
              <Button asChild>
                <Link href="/sessions/new">
                  <Plus aria-hidden="true" /> Create a session
                </Link>
              </Button>
              <Button asChild variant="text" size="md">
                <Link href="/solo/new">Walking now? Set a solo check-in</Link>
              </Button>
            </div>
          }
        />
      ) : (
        <>
          {mine ? (
            <YourSessionCard s={mine} now={now} />
          ) : (
            <Card className="flex flex-col gap-3">
              <Eyebrow>Your session</Eyebrow>
              <p className="text-[18px] font-extrabold">You haven&apos;t joined a session tonight</p>
              <p className="text-[15px] text-muted">Join one below to find a verified walk buddy when it ends.</p>
              <Button asChild variant="secondary">
                <Link href="/solo/new">
                  <Timer aria-hidden="true" /> Set a solo check-in instead
                </Link>
              </Button>
            </Card>
          )}

          {others.length > 0 && (
            <section aria-labelledby="ending-soon">
              <div className="flex items-center justify-between">
                <Eyebrow>
                  <span id="ending-soon">Ending soon tonight</span>
                </Eyebrow>
                <Link href="/sessions" className="inline-flex min-h-11 items-center text-[14px] font-bold text-amber">
                  All sessions
                </Link>
              </div>
              <ul className="mt-1 rounded-[22px] border border-line bg-surface px-4">
                {others.slice(0, 6).map((s) => (
                  <EventRow key={s.id} session={s} firstName={firstName} onJoined={onJoined} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <PrivacyNote>Flock uses stations, never home addresses. Matches only see your first name.</PrivacyNote>
    </Screen>
  );
}

function pickActive(rows: Active[]): Active | null {
  return rows.find((r) => r.kind === "match") ?? rows.find((r) => r.kind === "solo") ?? rows.find((r) => r.kind === "request") ?? null;
}

function TopBar({ initial }: { initial?: string }) {
  return (
    <div className="flex items-center justify-between pt-4">
      <Logo size={28} />
      <Link
        href="/safety"
        aria-label="Safety and your check-ins"
        className="flex size-11 items-center justify-center rounded-full bg-avatar-1 text-[16px] font-extrabold text-ink active:opacity-80"
      >
        {initial ? initial.trim().charAt(0).toUpperCase() : "?"}
      </Link>
    </div>
  );
}
