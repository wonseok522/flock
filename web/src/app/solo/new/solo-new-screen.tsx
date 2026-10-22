"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Check, Footprints, MessageCircle, Search, ShieldCheck, TrainFront } from "lucide-react";
import { Screen, ScreenTitle } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, ErrorCard, Eyebrow, LoadingScreen, PrivacyNote, Skeleton, Spinner } from "@/components/flock";
import { supabase } from "@/lib/supabase/client";
import { useMember } from "@/lib/use-member";
import { friendlyError } from "@/lib/errors";
import { metres, relativeEnd } from "@/lib/format";
import type { SessionOverview, Station } from "@/lib/types";
import { cn } from "@/lib/utils";

// Solo check-in timer (no buddy going your way). Supabase: search_stations +
// start_solo RPCs. If the timer runs out, the Flock worker alerts the session's
// Discord thread, then the society safety team 10 min later (Notion incident).

const DURATIONS = [10, 15, 20, 30] as const;
const VENUE_FALLBACK = { lat: 51.4951, lng: -0.2282 }; // Expedite London HQ
const WALK_M_PER_MIN = 80;

type Picked = { id: number; name: string; distance_m?: number };

export function SoloNewScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const me = useMember();
  const ready = me.status === "ready";

  const [sessions, setSessions] = useState<SessionOverview[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(params.get("session"));
  const [query, setQuery] = useState("");
  const [stations, setStations] = useState<Station[] | null>(null);
  const [stationsError, setStationsError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [minutes, setMinutes] = useState<number>(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  // Joined sessions, so the alert goes to the right Discord thread.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase().rpc("sessions_overview");
        if (error) throw error;
        const joined = ((data ?? []) as SessionOverview[]).filter((s) => s.joined);
        if (cancelled) return;
        setSessions(joined);
        setSessionsError(null);
        setSessionId((cur) => {
          if (cur && joined.some((s) => s.id === cur)) return cur;
          const live = joined.filter((s) => new Date(s.ends_at).getTime() > Date.now() - 3 * 60 * 60 * 1000);
          return live[0]?.id ?? null;
        });
      } catch (e) {
        if (!cancelled) setSessionsError(friendlyError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, retryNonce]);

  const session = useMemo(() => sessions?.find((s) => s.id === sessionId) ?? null, [sessions, sessionId]);
  const sessionsSettled = sessions !== null || sessionsError !== null;
  const origin = session?.lat != null && session?.lng != null ? { lat: session.lat, lng: session.lng } : VENUE_FALLBACK;

  // Preselect ?station=<osm id>.
  useEffect(() => {
    const raw = params.get("station");
    if (!ready || !raw || !/^\d+$/.test(raw)) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase().from("stations").select("id, name").eq("id", Number(raw)).maybeSingle();
      if (!cancelled && data) setPicked((p) => p ?? { id: Number((data as { id: number }).id), name: (data as { name: string }).name });
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, params]);

  // Station search, debounced. Empty query = nearest stations to the session.
  useEffect(() => {
    if (!ready || !sessionsSettled) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { data, error } = await supabase().rpc("search_stations", { p_query: query.trim(), p_lat: origin.lat, p_lng: origin.lng });
        if (error) throw error;
        if (!cancelled) {
          setStations((data ?? []) as Station[]);
          setStationsError(null);
        }
      } catch (e) {
        if (!cancelled) setStationsError(friendlyError(e));
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ready, sessionsSettled, query, origin.lat, origin.lng, retryNonce]);

  // Fill in the distance for a preselected station once it shows up in results.
  const pickedDistance = picked?.distance_m ?? stations?.find((s) => s.id === picked?.id)?.distance_m;
  const walkMin = pickedDistance != null ? Math.max(1, Math.round(pickedDistance / WALK_M_PER_MIN)) : null;

  async function start() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error } = await supabase().rpc("start_solo", { p_session: sessionId, p_station: picked.id, p_eta_minutes: minutes });
      if (error) throw error;
      router.push(`/solo/${data as string}`);
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  if (me.status === "loading") return <LoadingScreen />;
  if (me.status === "error") {
    return (
      <Screen>
        <ScreenTitle>Walk solo, not alone</ScreenTitle>
        <ErrorCard message={me.message} onRetry={me.reload} />
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="pt-6">
        <Button asChild variant="text" size="sm" className="-ml-3 px-3">
          <Link href={sessionId ? `/sessions/${sessionId}` : "/"} aria-label="Back">
            <ArrowLeft aria-hidden="true" /> Back
          </Link>
        </Button>
      </div>
      <header>
        <h1 className="text-[30px] leading-tight font-extrabold tracking-[-0.02em]">Walk solo, not alone</h1>
        <p className="mt-1 text-[16px] text-muted">Nobody heading your way? Set a timer. If you don&apos;t check in, your people hear about it.</p>
      </header>

      {/* Session */}
      <section aria-labelledby="session-h" className="flex flex-col gap-2">
        <Eyebrow>
          <span id="session-h">Leaving from</span>
        </Eyebrow>
        {sessionsError ? (
          <ErrorCard message={sessionsError} onRetry={() => setRetryNonce((n) => n + 1)} />
        ) : sessions === null ? (
          <Skeleton className="h-14" />
        ) : sessions.length === 0 ? (
          <p className="rounded-[18px] border border-line bg-surface p-4 text-[15px] text-muted">
            You haven&apos;t joined a session tonight, so there&apos;s no session group to alert. Your society safety team still gets alerted.{" "}
            <Link href="/sessions" className="font-semibold text-amber underline underline-offset-4">Join a session</Link>
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={s.id === sessionId}
                onClick={() => setSessionId(s.id)}
                className={cn(
                  "flex min-h-11 flex-col items-start rounded-[14px] border px-4 py-2 text-left",
                  s.id === sessionId ? "border-amber bg-amber-tint text-amber" : "border-line-strong bg-surface text-text",
                )}
              >
                <span className="text-[15px] font-bold">{s.title}</span>
                <span className="font-mono text-[12px] text-muted">{relativeEnd(s.ends_at)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Station */}
      <section aria-labelledby="station-h" className="flex flex-col gap-2">
        <label id="station-h" htmlFor="station-q" className="eyebrow">
          Your station
        </label>
        {picked ? (
          <div className="flex min-h-[56px] items-center gap-3 rounded-[16px] border border-amber bg-amber-tint px-4">
            <TrainFront className="size-5 shrink-0 text-amber" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px] font-bold">{picked.name}</p>
              {pickedDistance != null && (
                <p className="font-mono text-[13px] text-muted">
                  {metres(pickedDistance)} · about {walkMin} min on foot
                </p>
              )}
            </div>
            <Button variant="text" size="sm" onClick={() => setPicked(null)}>
              Change
            </Button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                id="station-q"
                type="search"
                autoComplete="off"
                placeholder="Search stations, e.g. Camden Town"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-[52px] w-full rounded-[14px] border border-line-strong bg-surface pr-4 pl-12 text-[16px] text-text placeholder:text-muted/70 focus:border-amber focus:outline-none"
              />
            </div>
            {stationsError ? (
              <ErrorCard message={stationsError} onRetry={() => setRetryNonce((n) => n + 1)} />
            ) : stations === null ? (
              <div className="flex flex-col gap-2" role="status" aria-label="Loading stations">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            ) : stations.length === 0 ? (
              <EmptyState title="No stations found" body="Try a shorter name, like “Camden”." />
            ) : (
              <ul className="flex max-h-[300px] flex-col overflow-y-auto rounded-[18px] border border-line bg-surface" aria-label="Stations">
                {stations.slice(0, 12).map((s) => (
                  <li key={s.id} className="border-b border-line last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setPicked({ id: s.id, name: s.name, distance_m: s.distance_m })}
                      className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left active:bg-surface-2"
                    >
                      <TrainFront className="size-5 shrink-0 text-muted" aria-hidden="true" />
                      <span className="flex-1 truncate text-[16px] font-semibold">{s.name}</span>
                      <span className="font-mono text-[13px] text-muted">{metres(s.distance_m)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <PrivacyNote>Stations only, never your home address.</PrivacyNote>
      </section>

      {/* Duration */}
      <section aria-labelledby="dur-h" className="flex flex-col gap-2">
        <Eyebrow>
          <span id="dur-h">Check in within</span>
        </Eyebrow>
        <div className="grid grid-cols-4 gap-2" role="group" aria-labelledby="dur-h">
          {DURATIONS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={minutes === m}
              onClick={() => setMinutes(m)}
              className={cn(
                "flex h-[52px] items-center justify-center gap-1 rounded-full border text-[16px] font-bold",
                minutes === m ? "border-amber bg-amber-tint text-amber" : "border-line-strong bg-surface text-text",
              )}
            >
              <span className="font-mono">{m}</span> min
            </button>
          ))}
        </div>
        {walkMin != null && walkMin > minutes && (
          <p className="text-[14px] text-amber">That station is about {walkMin} min on foot. Pick a longer timer so you aren&apos;t flagged by mistake.</p>
        )}
      </section>

      {/* Who gets alerted */}
      <Card className="flex flex-col gap-3">
        <Eyebrow>Who gets alerted, in order</Eyebrow>
        <ol className="flex flex-col gap-3">
          <li className="flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-tint font-mono text-[14px] font-semibold text-amber">1</span>
            <div>
              <p className="flex items-center gap-1.5 text-[16px] font-bold">
                <MessageCircle className="size-4 text-amber" aria-hidden="true" /> Your session group
              </p>
              <p className="text-[14px] text-muted">
                {session ? `The “${session.title}” Discord thread, ` : "Your session's Discord thread, "}
                at your check-in time if you haven&apos;t checked in.
              </p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-tint font-mono text-[14px] font-semibold text-amber">2</span>
            <div>
              <p className="flex items-center gap-1.5 text-[16px] font-bold">
                <ShieldCheck className="size-4 text-amber" aria-hidden="true" /> Your society safety team
              </p>
              <p className="text-[14px] text-muted">10 minutes later, with an incident in Safety HQ. A human decides what to do.</p>
            </div>
          </li>
        </ol>
        <p className="text-[13px] text-muted">They see your first name and station. Never your email or address.</p>
      </Card>

      {error && <ErrorCard message={error} />}
      <div className="flex flex-col gap-2">
        <Button onClick={start} disabled={!picked || busy}>
          {busy ? <Spinner /> : <Footprints aria-hidden="true" />} Start walk
        </Button>
        {!picked && <p className="text-center text-[14px] text-muted">Pick your station to start.</p>}
        <PrivacyNote>
          <Check className="mr-1 inline size-4 text-safe" aria-hidden="true" />
          Next, your phone asks to share your location, so your group can see you until you reach the station. Sharing stops 200 m before it.
        </PrivacyNote>
      </div>
    </Screen>
  );
}
