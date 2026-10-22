"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, BellRing, CircleCheck, House, MapPinOff, Pause, Phone, Plus, Radio, ShieldCheck, TrainFront } from "lucide-react";
import { Screen } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, ErrorCard, Eyebrow, LoadingScreen, Spinner } from "@/components/flock";
import { FlockMap, type MapMarker } from "@/components/map";
import { supabase } from "@/lib/supabase/client";
import { useMember } from "@/lib/use-member";
import { friendlyError } from "@/lib/errors";
import { clock, distanceM, hhmm } from "@/lib/format";
import type { MyTrip } from "@/lib/types";
import { cn } from "@/lib/utils";

// Solo check-in timer. Supabase: my_trip (polled every 10 s to show when the
// worker alerted the Discord thread / safety team), check_in, and a private
// Realtime broadcast channel `trip:<id>` for live location (never stored).

const POLL_MS = 10_000;
const SEND_EVERY_MS = 5_000;
const STOP_NEAR_STATION_M = 200;
const ESCALATE_AFTER_MS = 10 * 60 * 1000;

type Point = { lat: number; lng: number };
type ShareState = "idle" | "asking" | "live" | "off" | "paused" | "arrived" | "failed";

/** Broadcasts your position to the session group until you're within 200 m of the station. */
function useLiveLocation({ tripId, firstName, station, active }: { tripId: string; firstName: string | null; station: Point | null; active: boolean }) {
  const [state, setState] = useState<ShareState>("idle");
  const [pos, setPos] = useState<Point | null>(null);
  const [paused, setPaused] = useState(false);
  const [arrived, setArrived] = useState(false);
  const stationLat = station?.lat;
  const stationLng = station?.lng;

  useEffect(() => {
    if (!active || paused || arrived || !firstName || stationLat == null || stationLng == null) return;
    let cancelled = false;
    let watchId: number | null = null;
    let subscribed = false;
    let lastSent = 0;
    let last: Point | null = null;
    const sb = supabase();
    const channel = sb.channel(`trip:${tripId}`, { config: { private: true } });

    async function send(p: Point) {
      const t = Date.now();
      if (!subscribed || t - lastSent < SEND_EVERY_MS) return;
      lastSent = t;
      const res = await channel.send({ type: "broadcast", event: "location", payload: { first_name: firstName, lat: p.lat, lng: p.lng, at: new Date(t).toISOString() } });
      if (!cancelled) setState(res === "ok" ? "live" : "failed");
    }

    (async () => {
      try {
        await sb.realtime.setAuth();
      } catch {
        // Channel join below will fail and the pill says so.
      }
      if (cancelled) return;
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        setState("off");
        return;
      }
      setState("asking");
      channel.subscribe((status) => {
        if (cancelled) return;
        subscribed = status === "SUBSCRIBED";
        if (subscribed && last) void send(last);
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setState("failed");
      });
      watchId = navigator.geolocation.watchPosition(
        (p) => {
          if (cancelled) return;
          const here = { lat: p.coords.latitude, lng: p.coords.longitude };
          last = here;
          setPos(here);
          if (distanceM(here, { lat: stationLat, lng: stationLng }) <= STOP_NEAR_STATION_M) {
            setState("arrived");
            setArrived(true); // cleanup stops the watch and leaves the channel
            return;
          }
          void send(here);
        },
        (err) => {
          if (!cancelled) setState(err.code === err.PERMISSION_DENIED ? "off" : "failed");
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
      );
    })();

    return () => {
      cancelled = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      void sb.removeChannel(channel);
    };
  }, [active, paused, arrived, firstName, stationLat, stationLng, tripId]);

  const shown: ShareState = !active ? "idle" : paused ? "paused" : arrived ? "arrived" : state;
  return { state: shown, pos, pause: () => setPaused(true), resume: () => setPaused(false) };
}

function LivePill({ state, onPause, onResume }: { state: ShareState; onPause: () => void; onResume: () => void }) {
  const base = "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-[14px] font-bold shadow-lg";
  if (state === "live") {
    return (
      <button type="button" onClick={onPause} aria-label="Live, your group can see you. Tap to pause sharing" className={cn(base, "border-safe bg-ink/90 text-safe")}>
        <span className="size-2 rounded-full bg-safe motion-safe:animate-pulse" aria-hidden="true" /> Live · group can see you
        <Pause className="size-4" aria-hidden="true" />
      </button>
    );
  }
  if (state === "paused") {
    return (
      <button type="button" onClick={onResume} className={cn(base, "border-line-strong bg-ink/90 text-text")}>
        <Radio className="size-4" aria-hidden="true" /> Location paused · tap to share
      </button>
    );
  }
  const label: Partial<Record<ShareState, string>> = {
    asking: "Asking for your location…",
    off: "Location off",
    arrived: "Near the station · sharing stopped",
    failed: "Location not shared",
  };
  if (!label[state]) return null;
  return (
    <span role="status" className={cn(base, "border-line-strong bg-ink/90 text-muted")}>
      {state === "asking" ? <Spinner className="size-4" /> : <MapPinOff className="size-4" aria-hidden="true" />} {label[state]}
    </span>
  );
}

function CountdownRing({ remainingS, totalS, dueAt, overdueS }: { remainingS: number; totalS: number; dueAt: string; overdueS: number }) {
  const size = 220;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = totalS > 0 ? Math.min(1, Math.max(0, remainingS / totalS)) : 0;
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-2)" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--color-amber)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - frac)}
            className="transition-[stroke-dashoffset] duration-1000 ease-linear motion-reduce:transition-none"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
          {remainingS > 0 ? (
            <>
              <span className="font-mono text-[46px] leading-none font-semibold tabular-nums">{clock(remainingS)}</span>
              <span className="mt-2 text-[13px] font-semibold text-muted">left</span>
            </>
          ) : (
            <>
              <span className="text-[13px] font-bold tracking-[0.06em] text-amber uppercase">Overdue by</span>
              <span className="mt-1 font-mono text-[46px] leading-none font-semibold text-amber tabular-nums">{clock(overdueS)}</span>
            </>
          )}
        </div>
      </div>
      <p className="text-[16px] text-muted">
        check in by <span className="font-mono font-semibold text-amber">{hhmm(dueAt)}</span>
      </p>
      <span className="sr-only" role="timer">
        Check in by {hhmm(dueAt)}. {remainingS > 0 ? `${Math.ceil(remainingS / 60)} minutes left.` : `Overdue by ${Math.floor(overdueS / 60)} minutes.`}
      </span>
    </div>
  );
}

export function SoloScreen() {
  const { tripId } = useParams<{ tripId: string }>();
  const me = useMember();
  const ready = me.status === "ready";
  const firstName = me.status === "ready" ? me.member.first_name : null;

  const [trip, setTrip] = useState<MyTrip | null | undefined>(undefined); // undefined = loading, null = not found
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [extending, setExtending] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    async function load() {
      try {
        const { data, error } = await supabase().rpc("my_trip", { p_trip: tripId });
        if (error) throw error;
        if (cancelled) return;
        setTrip(((data ?? []) as MyTrip[])[0] ?? null);
        setLoadError(null);
      } catch (e) {
        if (!cancelled) setLoadError(friendlyError(e));
      }
    }
    void load();
    const t = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [ready, tripId, nonce]);

  const sharingActive = Boolean(trip && (trip.status === "active" || trip.status === "overdue"));
  const station = trip ? { lat: trip.station_lat, lng: trip.station_lng } : null;
  const live = useLiveLocation({ tripId, firstName, station, active: sharingActive });

  const checkInHome = useCallback(async () => {
    setBusy(true);
    setCheckError(null);
    try {
      const { error } = await supabase().rpc("check_in", { p_match: null, p_trip: tripId, p_status: "home_safe" });
      if (error) throw error;
      setTrip((t) => (t ? { ...t, status: "home_safe" } : t));
    } catch (e) {
      setCheckError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }, [tripId]);

  const addTime = useCallback(async () => {
    setExtending(true);
    setCheckError(null);
    try {
      const { data, error } = await supabase().rpc("extend_solo", { p_trip: tripId, p_minutes: 10 });
      if (error) throw error;
      setTrip((t) => (t ? { ...t, eta_at: data as string } : t));
    } catch (e) {
      setCheckError(friendlyError(e));
    } finally {
      setExtending(false);
    }
  }, [tripId]);

  if (me.status === "loading" || (ready && trip === undefined && !loadError)) return <LoadingScreen label="Loading your timer…" />;
  if (me.status === "error") {
    return (
      <Screen>
        <div className="pt-10">
          <ErrorCard message={me.message} onRetry={me.reload} />
        </div>
      </Screen>
    );
  }
  if (trip === undefined && loadError) {
    return (
      <Screen>
        <div className="pt-10">
          <ErrorCard message={loadError} onRetry={() => setNonce((n) => n + 1)} />
        </div>
      </Screen>
    );
  }
  if (!trip) {
    return (
      <Screen>
        <div className="pt-10">
          <EmptyState
            title="We couldn't find this timer"
            body="It may belong to another account, or it was started more than a day ago."
            action={
              <Button asChild>
                <Link href="/solo/new">Start a new check-in</Link>
              </Button>
            }
          />
        </div>
      </Screen>
    );
  }

  if (trip.status === "home_safe") {
    return (
      <Screen>
        <div className="flex flex-1 flex-col items-center justify-center gap-5 pt-16 text-center">
          <span className="flex size-24 items-center justify-center rounded-full bg-safe-tint text-safe">
            <CircleCheck className="size-12" strokeWidth={2.25} aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-[30px] leading-tight font-extrabold tracking-[-0.02em]">You&apos;re home. Nice one.</h1>
            <p className="mt-2 text-[16px] text-muted">Checked in after walking to {trip.station_name}.{" "}
              {trip.alerted_at ? "The incident is closed, so your group and safety team can see you're safe." : "Nobody gets alerted."}</p>
          </div>
          <Button asChild className="mt-4">
            <Link href="/">Back to Tonight</Link>
          </Button>
        </div>
      </Screen>
    );
  }

  const dueMs = new Date(trip.eta_at).getTime();
  const remainingS = Math.max(0, (dueMs - now) / 1000);
  const totalS = Math.max(1, (dueMs - new Date(trip.leave_at).getTime()) / 1000);
  const overdue = remainingS <= 0 || trip.status === "overdue";
  const sessionPoint = trip.session_lat != null && trip.session_lng != null ? { lat: trip.session_lat, lng: trip.session_lng } : null;
  const stationPoint = { lat: trip.station_lat, lng: trip.station_lng };
  const progress =
    sessionPoint && live.pos
      ? Math.min(1, Math.max(0, 1 - distanceM(live.pos, stationPoint) / Math.max(1, distanceM(sessionPoint, stationPoint))))
      : 0;
  const markers: MapMarker[] = [
    ...(sessionPoint ? [{ ...sessionPoint, kind: "session" as const }] : []),
    { ...stationPoint, kind: "station", label: trip.station_name },
    ...(live.pos ? [{ ...live.pos, kind: "you" as const, label: "You" }] : []),
  ];

  return (
    <Screen>
      <div className="flex items-center justify-between pt-6">
        <Button asChild variant="text" size="sm" className="-ml-3 px-3">
          <Link href="/" aria-label="Back to Tonight">
            <ArrowLeft aria-hidden="true" /> Tonight
          </Link>
        </Button>
        <Link href="/safety" className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-bold text-muted">
          <Phone className="size-4" aria-hidden="true" /> Who do I call?
        </Link>
      </div>

      <header>
        <Eyebrow>Solo check-in</Eyebrow>
        <h1 className="mt-1 flex items-center gap-2 text-[26px] leading-tight font-extrabold tracking-[-0.02em]">
          <TrainFront className="size-6 shrink-0 text-amber" aria-hidden="true" /> {trip.station_name}
        </h1>
        {trip.session_title && <p className="text-[15px] text-muted">From {trip.session_title}</p>}
      </header>

      <CountdownRing remainingS={remainingS} totalS={totalS} dueAt={trip.eta_at} overdueS={Math.max(0, (now - dueMs) / 1000)} />
      {trip.status === "active" && !overdue && (
        <div className="-mt-2 flex justify-center">
          <Button type="button" variant="chip" size="sm" onClick={addTime} disabled={extending}>
            {extending ? <Spinner className="size-4" /> : <Plus className="size-4" aria-hidden="true" />} Add 10 min
          </Button>
        </div>
      )}

      {trip.status === "help" ? (
        <section role="alert" className="rounded-[22px] border border-danger bg-danger-surface p-5">
          <p className="text-[18px] font-extrabold">Your group and society have been alerted</p>
          <p className="mt-1 text-[15px] text-danger-soft">In an emergency, call 999.</p>
        </section>
      ) : overdue ? (
        <section role="status" className="flex flex-col gap-3 rounded-[22px] border border-amber bg-amber-tint p-5">
          <p className="flex items-center gap-2 text-[18px] font-extrabold text-amber">
            <BellRing className="size-5" aria-hidden="true" />
            {trip.session_id ? "Your session group is being alerted" : "Your society safety team is being alerted"}
          </p>
          <p className="text-[15px] text-text">If you&apos;re safe, tap I&apos;m home and we&apos;ll let them know.</p>
          <ol className="flex flex-col gap-1.5 text-[14px] text-muted">
            {trip.session_id && (
              <li>
                Session group:{" "}
                {trip.alerted_at ? (
                  <span className="font-semibold text-text">
                    flagged at <span className="font-mono">{hhmm(trip.alerted_at)}</span>
                  </span>
                ) : (
                  "alerting now"
                )}
              </li>
            )}
            <li>
              Society safety team:{" "}
              {trip.escalated_at ? (
                <span className="font-semibold text-text">
                  alerted at <span className="font-mono">{hhmm(trip.escalated_at)}</span>
                </span>
              ) : (
                <>
                  at <span className="font-mono">{hhmm(new Date(dueMs + ESCALATE_AFTER_MS))}</span>
                </>
              )}
            </li>
          </ol>
        </section>
      ) : null}

      <div className="relative overflow-hidden rounded-[22px] border border-line">
        <FlockMap markers={markers} route={sessionPoint ? { from: sessionPoint, to: stationPoint, progress } : undefined} height={200} />
        <div className="pointer-events-none absolute top-3 left-3 z-[500] [&>*]:pointer-events-auto">
          <LivePill state={live.state} onPause={live.pause} onResume={live.resume} />
        </div>
      </div>
      {live.state === "off" && <p className="-mt-2 text-[14px] text-muted">Location is off. That&apos;s fine: your check-in timer still protects you.</p>}

      {checkError && <ErrorCard message={checkError} />}
      <div className="flex gap-3">
        <Button variant="safe" className="flex-1" onClick={checkInHome} disabled={busy}>
          {busy ? <Spinner /> : <House aria-hidden="true" />} I&apos;m home
        </Button>
        <Button asChild variant="danger" className="w-[112px] shrink-0">
          <Link href={`/sos?trip=${trip.trip_id}`} aria-label="SOS: get help now">
            SOS
          </Link>
        </Button>
      </div>

      {!overdue && trip.status !== "help" && (
        <Card className="flex flex-col gap-2">
          <Eyebrow>If you don&apos;t check in</Eyebrow>
          <p className="flex items-start gap-2 text-[15px]">
            <BellRing className="mt-0.5 size-4 shrink-0 text-amber" aria-hidden="true" />
            {trip.session_id ? (
              <span>
                Your session group&apos;s Discord thread at <span className="font-mono">{hhmm(trip.eta_at)}</span>
              </span>
            ) : (
              <span>No session group for this walk</span>
            )}
          </p>
          <p className="flex items-start gap-2 text-[15px]">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber" aria-hidden="true" />
            <span>
              Your society safety team at <span className="font-mono">{hhmm(new Date(dueMs + ESCALATE_AFTER_MS))}</span>
            </span>
          </p>
        </Card>
      )}
    </Screen>
  );
}
