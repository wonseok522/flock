"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { ArrowLeft, Check, Clock, MapPin, Search, ShieldCheck, TrainFront, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Screen, ScreenTitle } from "@/components/app-shell";
import { Avatar, Card, EmptyState, ErrorCard, Eyebrow, PrivacyNote, Skeleton, Spinner, TimeChip, VerifiedBadge } from "@/components/flock";
import { supabase } from "@/lib/supabase/client";
import { useMember } from "@/lib/use-member";
import { friendlyError } from "@/lib/errors";
import { hhmm, metres } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Active, Candidate, SessionOverview, Station } from "@/lib/types";

// Fallback venue when a session has no coordinates (CLAUDE.md: Expedite London HQ).
const FALLBACK_ORIGIN = { lat: 51.4951, lng: -0.2282 };
const LEAVE_OPTIONS = [
  { label: "Now", minutes: 0 },
  { label: "+10 min", minutes: 10 },
  { label: "+20 min", minutes: 20 },
  { label: "+30 min", minutes: 30 },
] as const;
const POLL_MS = 3000;

// ───────────── Shared helpers (also used by /walk/[matchId]) ─────────────

const UNIS: [string, string][] = [
  ["ucl.ac.uk", "UCL"],
  ["kcl.ac.uk", "King's"],
  ["imperial.ac.uk", "Imperial"],
  ["ic.ac.uk", "Imperial"],
  ["lse.ac.uk", "LSE"],
  ["qmul.ac.uk", "Queen Mary"],
];

/** Short university name for a verified email domain, e.g. "ucl.ac.uk" → "UCL". */
export function uniName(domain: string): string {
  const d = domain.toLowerCase();
  for (const [suffix, name] of UNIS) if (d === suffix || d.endsWith(`.${suffix}`)) return name;
  const first = d.split(".")[0] ?? "";
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "university";
}

/**
 * Trust reasons shown on a match, one fact per line. The "Verified X student"
 * reason is dropped because the badge already says it. Never a score.
 */
export function trustLines(reasons: string[], safeWalks: number, lead?: string): string[] {
  const out: string[] = lead ? [lead] : [];
  for (const raw of reasons) {
    const r = raw.trim();
    if (!r || /^verified .+ student$/i.test(r) || out.includes(r)) continue;
    out.push(r);
  }
  if (safeWalks > 0 && !out.some((l) => /safe walk/i.test(l))) {
    out.push(`${safeWalks} safe ${safeWalks === 1 ? "walk" : "walks"} with Flock`);
  }
  return out;
}

/** "0:12", "3:05": the live elapsed timer. */
function elapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function TrustList({ name, lines }: { name: string; lines: string[] }) {
  return (
    <div>
      <Eyebrow>Why you can trust {name}</Eyebrow>
      <ul className="mt-2 flex flex-col gap-2">
        {lines.map((line) => (
          <li key={line} className="flex items-start gap-2.5 text-[15px] leading-snug font-semibold">
            <Check className="mt-0.5 size-5 shrink-0 text-safe" strokeWidth={2.5} aria-hidden="true" />
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ───────────── Screen ─────────────

type Picked = { id: number; name: string; distance_m: number | null };
type Phase =
  | { step: "pick" }
  | { step: "wait"; requestId: string; requestedAt: number; station: Picked; leaveAt: string };

export function WalkRequestScreen() {
  const { id: sessionId } = useParams<{ id: string }>();
  const router = useRouter();
  const member = useMember();

  // Session + resume state
  const [session, setSession] = useState<SessionOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);
  const [phase, setPhase] = useState<Phase>({ step: "pick" });

  useEffect(() => {
    if (member.status !== "ready") return;
    let cancelled = false;
    (async () => {
      try {
        const sb = supabase();
        const [overview, active] = await Promise.all([sb.rpc("sessions_overview"), sb.rpc("my_active")]);
        if (overview.error) throw overview.error;
        if (active.error) throw active.error;
        const acts = (active.data ?? []) as Active[];
        const match = acts.find((a) => a.kind === "match");
        if (match) {
          router.replace(`/walk/${match.id}`);
          return;
        }
        const s = ((overview.data ?? []) as SessionOverview[]).find((x) => x.id === sessionId) ?? null;
        if (cancelled) return;
        if (!s) {
          setNotFound(true);
          return;
        }
        // Resume an open request for this session (e.g. after a reload).
        const open = acts.find((a) => a.kind === "request" && a.session_id === sessionId);
        if (open) {
          const { data: req } = await sb.from("walk_requests").select("station_id, leave_at, created_at").eq("id", open.id).maybeSingle();
          if (req) {
            const { data: st } = await sb.from("stations").select("name").eq("id", req.station_id).maybeSingle();
            if (!cancelled) {
              setPhase({
                step: "wait",
                requestId: open.id,
                requestedAt: new Date(req.created_at as string).getTime(),
                station: { id: req.station_id as number, name: (st?.name as string | undefined) ?? "your station", distance_m: null },
                leaveAt: req.leave_at as string,
              });
            }
          }
        }
        if (!cancelled) {
          setSession(s);
          setLoadError(null);
        }
      } catch (e) {
        if (!cancelled) setLoadError(friendlyError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [member.status, sessionId, router, loadNonce]);

  if (member.status === "error") {
    return (
      <Screen>
        <BackLink sessionId={sessionId} />
        <ErrorCard message={member.message} onRetry={member.reload} />
      </Screen>
    );
  }
  if (loadError) {
    return (
      <Screen>
        <BackLink sessionId={sessionId} />
        <ErrorCard message={loadError} onRetry={() => { setLoadError(null); setLoadNonce((n) => n + 1); }} />
      </Screen>
    );
  }
  if (notFound) {
    return (
      <Screen>
        <BackLink sessionId={sessionId} />
        <EmptyState
          title="This session isn't available"
          body="It may have ended, or it belongs to a community you're not in."
          action={<Button asChild variant="secondary" size="md"><Link href="/sessions">See tonight&apos;s sessions</Link></Button>}
        />
      </Screen>
    );
  }
  if (member.status === "loading" || !session) return <WalkSkeleton />;

  return phase.step === "pick" ? (
    <PickStep session={session} onRequested={setPhase} />
  ) : (
    <WaitStep session={session} phase={phase} firstName={member.member.first_name} onCancelled={() => setPhase({ step: "pick" })} />
  );
}

function BackLink({ sessionId }: { sessionId: string }) {
  return (
    <div className="pt-4">
      <Link href={`/sessions/${sessionId}`} className="-ml-2 inline-flex min-h-11 items-center gap-1 px-2 text-[15px] font-semibold text-muted active:text-text">
        <ArrowLeft className="size-5" aria-hidden="true" /> Session
      </Link>
    </div>
  );
}

function WalkSkeleton() {
  return (
    <Screen>
      <div role="status" aria-live="polite" className="flex flex-col gap-4 pt-14">
        <span className="sr-only">Loading walk options…</span>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-[52px]" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    </Screen>
  );
}

// ───────────── Step 1: where are you heading? ─────────────

function PickStep({ session, onRequested }: { session: SessionOverview; onRequested: (p: Phase) => void }) {
  const origin = useMemo(
    () => (session.lat != null && session.lng != null ? { lat: session.lat, lng: session.lng } : FALLBACK_ORIGIN),
    [session.lat, session.lng],
  );
  const hasVenue = session.lat != null && session.lng != null;
  const [query, setQuery] = useState("");
  const [stations, setStations] = useState<Station[] | null>(null);
  const [searching, setSearching] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchNonce, setSearchNonce] = useState(0);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [leaveIn, setLeaveIn] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced station search (PostGIS, nearest to the session first).
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { data, error } = await supabase().rpc("search_stations", { p_query: query.trim(), p_lat: origin.lat, p_lng: origin.lng });
        if (error) throw error;
        if (!cancelled) {
          setStations((data ?? []) as Station[]);
          setSearchError(null);
        }
      } catch (e) {
        if (!cancelled) setSearchError(friendlyError(e));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, origin, searchNonce]);

  async function findBuddy() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const sb = supabase();
      if (!session.joined) {
        const { error: joinError } = await sb.rpc("join_session", { p_session: session.id });
        if (joinError) throw joinError;
      }
      const leaveAt = new Date(Date.now() + leaveIn * 60_000).toISOString();
      const requestedAt = Date.now();
      const { data, error: reqError } = await sb.rpc("request_walk", { p_session: session.id, p_station: picked.id, p_leave_at: leaveAt });
      if (reqError) throw reqError;
      onRequested({ step: "wait", requestId: data as string, requestedAt, station: picked, leaveAt });
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <BackLink sessionId={session.id} />
      <ScreenTitle sub={<>From <span className="font-semibold text-text">{session.location_name || session.title}</span></>}>
        Where are you heading?
      </ScreenTitle>

      {picked ? (
        <div className="flex items-center gap-3 rounded-[18px] border border-amber bg-amber-tint p-4">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-amber">
            <TrainFront className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[18px] font-extrabold">{picked.name}</p>
            {picked.distance_m != null && hasVenue && (
              <p className="text-[13px] text-muted">
                <span className="font-mono">{metres(picked.distance_m)}</span> from the session
              </p>
            )}
          </div>
          <Button variant="chip" size="sm" onClick={() => setPicked(null)}>
            Change
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <label htmlFor="station-search" className="text-[13px] font-semibold text-muted">Destination station</label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                id="station-search"
                type="search"
                autoComplete="off"
                enterKeyHint="search"
                placeholder="Search stations, e.g. Hammersmith"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearching(true);
                }}
                className="h-[52px] w-full rounded-[14px] border border-line-strong bg-surface pr-11 pl-12 text-[16px] text-text placeholder:text-muted/70 focus:border-amber focus:outline-none"
              />
              {searching && stations && <Spinner className="absolute top-1/2 right-4 -translate-y-1/2 text-muted" />}
            </div>
          </div>

          {searchError ? (
            <ErrorCard message={searchError} onRetry={() => { setSearching(true); setSearchNonce((n) => n + 1); }} />
          ) : !stations ? (
            <div className="flex flex-col gap-2" role="status" aria-label="Loading stations">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : stations.length === 0 ? (
            <EmptyState title={`No stations match "${query.trim()}"`} body="Try part of the name, like “King's” or “Euston”." />
          ) : (
            <ul className="flex flex-col gap-2" aria-label={query.trim() ? "Matching stations" : "Nearest stations"}>
              {!query.trim() && <Eyebrow className="pt-1">{hasVenue ? "Nearest to the session" : "Nearby stations"}</Eyebrow>}
              {stations.slice(0, 8).map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setPicked({ id: s.id, name: s.name, distance_m: s.distance_m })}
                    className="flex min-h-16 w-full items-center gap-3 rounded-[16px] border border-line bg-surface px-4 py-3 text-left active:border-amber active:bg-surface-2"
                  >
                    <TrainFront className="size-5 shrink-0 text-amber" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-[16px] font-bold">{s.name}</span>
                    {hasVenue && <span className="shrink-0 font-mono text-[14px] text-muted">{metres(s.distance_m)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[13px] font-semibold text-muted">When are you leaving?</legend>
        <div className="grid grid-cols-4 gap-2">
          {LEAVE_OPTIONS.map((o) => {
            const on = leaveIn === o.minutes;
            return (
              <button
                key={o.minutes}
                type="button"
                aria-pressed={on}
                onClick={() => setLeaveIn(o.minutes)}
                className={cn(
                  "h-12 rounded-full border text-[15px] font-bold",
                  on ? "border-amber bg-amber-tint text-amber" : "border-line-strong bg-transparent text-text active:bg-surface-2",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <PrivacyNote>
        <ShieldCheck className="mr-1 inline size-4 text-safe" aria-hidden="true" />
        Stations only — never your home address. Matches only see your first name.
      </PrivacyNote>

      {error && <ErrorCard message={error} />}

      <div className="mt-auto flex flex-col gap-2 pt-2">
        <Button onClick={findBuddy} disabled={!picked || busy}>
          {busy ? <Spinner /> : null}
          {busy ? "Finding people…" : picked ? "Find a walk buddy" : "Pick a station first"}
        </Button>
        <Button asChild variant="secondary">
          <Link href={`/solo/new?session=${session.id}${picked ? `&station=${picked.id}` : ""}`}>Set a solo check-in instead</Link>
        </Button>
      </div>
    </Screen>
  );
}

// ───────────── Step 2: live candidates ─────────────

function WaitStep({
  session,
  phase,
  firstName,
  onCancelled,
}: {
  session: SessionOverview;
  phase: Extract<Phase, { step: "wait" }>;
  firstName: string;
  onCancelled: () => void;
}) {
  const router = useRouter();
  const { requestId, requestedAt, station, leaveAt } = phase;
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [foundAfter, setFoundAfter] = useState<number | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [chooseError, setChooseError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [closed, setClosed] = useState(false);
  const [now, setNow] = useState(0);

  const inFlight = useRef(false);
  const choosingRef = useRef(false);
  const leavingRef = useRef(false);
  const foundRef = useRef(false);

  const goToMatch = useCallback(
    (matchId: string, chosen: boolean) => {
      if (leavingRef.current) return;
      leavingRef.current = true;
      router.push(chosen ? `/walk/${matchId}?chosen=1` : `/walk/${matchId}`);
    },
    [router],
  );

  const poll = useCallback(async () => {
    if (inFlight.current || choosingRef.current || leavingRef.current) return;
    inFlight.current = true;
    try {
      const sb = supabase();
      const [buddies, active] = await Promise.all([sb.rpc("find_buddies", { p_request: requestId }), sb.rpc("my_active")]);
      if (choosingRef.current || leavingRef.current) return;
      // Fallback for blocked Realtime: if my request is no longer open and a
      // walk is active, someone chose me.
      if (!active.error) {
        const acts = (active.data ?? []) as Active[];
        const stillOpen = acts.some((a) => a.kind === "request" && a.id === requestId);
        const match = acts.find((a) => a.kind === "match");
        if (!stillOpen && match) {
          goToMatch(match.id, true);
          return;
        }
        if (!stillOpen && !match) {
          setClosed(true);
          return;
        }
      }
      if (buddies.error) throw buddies.error;
      const list = (buddies.data ?? []) as Candidate[];
      setCandidates(list);
      setPollError(null);
      if (list.length > 0 && !foundRef.current) {
        foundRef.current = true;
        setFoundAfter(Math.max(1, Math.round((Date.now() - requestedAt) / 1000)));
      }
    } catch (e) {
      setPollError(friendlyError(e));
    } finally {
      inFlight.current = false;
    }
  }, [requestId, requestedAt, goToMatch]);

  // Poll every 3 s (plus once immediately).
  useEffect(() => {
    const first = setTimeout(() => void poll(), 0);
    const t = setInterval(() => void poll(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [poll]);

  // Live elapsed timer.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  // Realtime: someone chose me → their match row INSERT reaches my phone (RLS).
  useEffect(() => {
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    const sb = supabase();
    (async () => {
      try {
        await sb.realtime.setAuth();
      } catch {
        // Polling still covers us.
      }
      if (cancelled) return;
      channel = sb
        .channel(`matches-for-${requestId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "matches" }, async (payload) => {
          const row = payload.new as { id?: string; request_a?: string; request_b?: string };
          if (!row.id || choosingRef.current || leavingRef.current) return;
          if (row.request_b === requestId) return; // I chose; choose() navigates.
          if (row.request_a === requestId) {
            goToMatch(row.id, true);
            return;
          }
          if (row.request_a || row.request_b) return; // a different request of mine
          const { data } = await sb.rpc("my_match", { p_match: row.id });
          if (Array.isArray(data) && data.length > 0) goToMatch(row.id, true);
        })
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) void sb.removeChannel(channel);
    };
  }, [requestId, goToMatch]);

  async function choose(c: Candidate) {
    choosingRef.current = true;
    setChoosing(c.candidate_request);
    setChooseError(null);
    try {
      const { data, error } = await supabase().rpc("choose_buddy", { p_request: requestId, p_candidate: c.candidate_request });
      if (error) throw error;
      leavingRef.current = true;
      router.push(`/walk/${data as string}`);
    } catch (e) {
      setChooseError(friendlyError(e));
      choosingRef.current = false;
      setChoosing(null);
      setSelectedId(null);
      void poll();
    }
  }

  async function cancel() {
    setCancelling(true);
    try {
      const { error } = await supabase().rpc("cancel_walk", { p_request: requestId });
      if (error) throw error;
      leavingRef.current = true;
      onCancelled();
    } catch (e) {
      setChooseError(friendlyError(e));
      setCancelling(false);
    }
  }

  const waitingSeconds = now ? (now - requestedAt) / 1000 : 0;
  const list = candidates ?? [];
  const selected = list.find((c) => c.candidate_request === selectedId) ?? list[0] ?? null;
  const alternatives = selected ? list.filter((c) => c.candidate_request !== selected.candidate_request) : [];
  const soloHref = `/solo/new?session=${session.id}&station=${station.id}`;
  const sessionLead = `At ${session.title} with you tonight`;

  if (closed) {
    return (
      <Screen>
        <BackLink sessionId={session.id} />
        <ScreenTitle>This request has closed</ScreenTitle>
        <EmptyState
          title="Your walk request isn't open any more"
          body="It may have been cancelled on another device or replaced by a solo check-in."
          action={<Button onClick={onCancelled} size="md">Start a new request</Button>}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <BackLink sessionId={session.id} />
      <ScreenTitle
        sub={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1"><TrainFront className="size-4" aria-hidden="true" /> {station.name}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1"><Clock className="size-4" aria-hidden="true" /> leaving <span className="font-mono text-text">{hhmm(leaveAt)}</span></span>
          </span>
        }
      >
        {selected ? (list.length === 1 ? "Someone's heading your way" : `${list.length} people heading your way`) : "Looking for a buddy"}
      </ScreenTitle>

      {!selected && (
        <Card className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="relative flex size-3" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber opacity-60" />
            <span className="relative inline-flex size-3 rounded-full bg-amber" />
          </span>
          <p className="text-[15px] font-semibold text-muted">Looking for</p>
          <p className="font-mono text-[48px] leading-none font-semibold text-amber" role="timer" aria-live="off">
            {elapsed(waitingSeconds)}
          </p>
          <p className="max-w-[18rem] text-[15px] text-muted" aria-live="polite">
            {candidates === null && !pollError ? "Checking who's going your way…" : "We'll show people as they join — no need to refresh."}
          </p>
        </Card>
      )}

      {pollError && <ErrorCard message={`Couldn't check for buddies: ${pollError}`} onRetry={() => void poll()} />}

      {selected && (
        <>
          {foundAfter != null && (
            <p className="-mt-2 text-[14px] text-muted">
              Found in <span className="font-mono font-semibold text-amber">{foundAfter}</span>{" "}
              {foundAfter === 1 ? "second" : "seconds"}, {firstName}. Pick who you&apos;d like to walk with.
            </p>
          )}
          <Card highlight className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <Avatar name={selected.first_name} size={56} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[22px] leading-tight font-extrabold">{selected.first_name}</p>
                <div className="mt-1">
                  <VerifiedBadge label={`Verified ${uniName(selected.uni_domain)} student`} />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[15px]">
              <TimeChip>leaving {hhmm(selected.leave_at)}</TimeChip>
              <span className="inline-flex items-center gap-1 text-muted">
                <MapPin className="size-4" aria-hidden="true" />
                {selected.station_name} · <span className="font-mono">{metres(selected.dest_distance_m)}</span> from yours
              </span>
            </div>
            <hr className="border-line" />
            <TrustList name={selected.first_name} lines={trustLines(selected.trust_reasons, selected.safe_walks, sessionLead)} />
          </Card>

          {chooseError && <ErrorCard message={chooseError} />}

          <Button onClick={() => choose(selected)} disabled={choosing !== null}>
            {choosing === selected.candidate_request ? <Spinner /> : null}
            Walk with {selected.first_name}
          </Button>

          {alternatives.length > 0 && (
            <div className="flex flex-col gap-2">
              <Eyebrow>Also heading your way</Eyebrow>
              <ul className="flex flex-col gap-2">
                {alternatives.map((c) => (
                  <li key={c.candidate_request}>
                    <button
                      type="button"
                      aria-label={`See ${c.first_name}, heading to ${c.station_name}, leaving ${hhmm(c.leave_at)}`}
                      onClick={() => setSelectedId(c.candidate_request)}
                      className="flex min-h-16 w-full items-center gap-3 rounded-[18px] border border-line bg-surface px-4 py-3 text-left active:bg-surface-2"
                    >
                      <Avatar name={c.first_name} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[16px] font-bold">{c.first_name}</span>
                        <span className="block truncate text-[13px] text-muted">
                          {c.station_name} · {uniName(c.uni_domain)}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[14px] font-semibold text-amber">{hhmm(c.leave_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {!selected && chooseError && <ErrorCard message={chooseError} />}

      <div className="mt-auto flex flex-col items-center gap-1 pt-2">
        <Button asChild variant="text" size="md">
          <Link href={soloHref}>Not right? Walk solo with a check-in</Link>
        </Button>
        <Button variant="text" size="md" onClick={cancel} disabled={cancelling || choosing !== null}>
          {cancelling ? <Spinner /> : <X aria-hidden="true" />} Cancel
        </Button>
      </div>
    </Screen>
  );
}
