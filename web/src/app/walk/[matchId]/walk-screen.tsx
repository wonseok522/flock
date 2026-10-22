"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { ArrowLeft, BellRing, Flag, HandHeart, House, MapPin, PartyPopper, Siren, Sparkles, TrainFront, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/app-shell";
import { Avatar, EmptyState, ErrorCard, Eyebrow, FallbackLabel, LoadingScreen, Spinner, TimeChip, VerifiedBadge } from "@/components/flock";
import { FlockMap, type MapMarker, type MapPoint } from "@/components/map";
import { supabase } from "@/lib/supabase/client";
import { useMember } from "@/lib/use-member";
import { friendlyError } from "@/lib/errors";
import { distanceM, hhmm } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MyMatch } from "@/lib/types";
import { TrustList, trustLines, uniName } from "@/app/sessions/[id]/walk/walk-request-screen";

const REFRESH_MS = 10_000;
// Cognee runs on free-tier Gemini: ai-service times out at 25 s, the worker at 30 s.
const REASON_TIMEOUT_MS = 30_000;
const BROADCAST_EVERY_MS = 5_000;
const STOP_NEAR_STATION_M = 200;

// Room for the back button + live pill on top and the sheet's 28px overlap below.
const MAP_PAD = { topLeft: [40, 96] as [number, number], bottomRight: [40, 56] as [number, number] };

type Share = "asking" | "sharing" | "paused" | "denied" | "unsupported" | "arrived" | "off";
type LivePoint = MapPoint & { first_name: string; at: string };

export function WalkScreen() {
  const { matchId } = useParams<{ matchId: string }>();
  const search = useSearchParams();
  const chosen = search.get("chosen") === "1";
  const member = useMember();
  const ready = member.status === "ready";
  const myName = ready ? member.member.first_name : "";

  const [match, setMatch] = useState<MyMatch | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reasonTimedOut, setReasonTimedOut] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [vouching, setVouching] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  // Live location (Realtime broadcast only; never stored).
  const [share, setShare] = useState<Share>("off");
  const [channelLive, setChannelLive] = useState(false);
  const [myPos, setMyPos] = useState<MapPoint | null>(null);
  const [buddyPos, setBuddyPos] = useState<LivePoint | null>(null);
  const watchId = useRef<number | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const channelReady = useRef(false);
  const lastSent = useRef(0);
  const matchRef = useRef<MyMatch | null>(null);
  const nameRef = useRef("");
  const autoStarted = useRef(false);

  useEffect(() => {
    nameRef.current = myName;
  }, [myName]);

  const stopSharing = useCallback((next: Share) => {
    if (watchId.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId.current);
    }
    watchId.current = null;
    setShare(next);
  }, []);

  const startSharing = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setShare("unsupported");
      return;
    }
    if (watchId.current !== null) return;
    setShare("asking");
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMyPos(p);
        const m = matchRef.current;
        // Privacy: stop near the destination station so it never gets near a home.
        if (m && distanceM(p, { lat: m.my_station_lat, lng: m.my_station_lng }) <= STOP_NEAR_STATION_M) {
          if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
          watchId.current = null;
          setShare("arrived");
          return;
        }
        setShare("sharing");
        const now = Date.now();
        const ch = channelRef.current;
        if (ch && channelReady.current && now - lastSent.current >= BROADCAST_EVERY_MS) {
          lastSent.current = now;
          void ch.send({
            type: "broadcast",
            event: "location",
            payload: { first_name: nameRef.current, lat: p.lat, lng: p.lng, at: new Date(now).toISOString() },
          });
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
          watchId.current = null;
          setShare("denied");
        }
        // Timeouts / no fix: keep watching; the pill stays on "Finding you…".
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 },
    );
  }, []);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase().rpc("my_match", { p_match: matchId });
      if (error) throw error;
      const row = ((data ?? []) as MyMatch[])[0];
      if (!row) {
        setMissing(true);
        return;
      }
      matchRef.current = row;
      setMatch(row);
      setLoadError(null);
      if (row.status === "home_safe" || row.my_checkin === "home_safe") {
        stopSharing("off");
      }
    } catch (e) {
      setLoadError(friendlyError(e));
    }
  }, [matchId, stopSharing]);

  // Load + 10 s refresh (buddy check-ins don't touch the matches row).
  useEffect(() => {
    if (!ready) return;
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [ready, load]);

  // Cognee reason: label the fallback if nothing arrives within 10 s.
  useEffect(() => {
    const t = setTimeout(() => setReasonTimedOut(true), REASON_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  // Realtime: UPDATEs to this match (Cognee reason, status) → re-fetch.
  useEffect(() => {
    if (!ready) return;
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
        .channel(`match-row:${matchId}`)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "matches", filter: `id=eq.${matchId}` }, () => void load())
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) void sb.removeChannel(channel);
    };
  }, [ready, matchId, load]);

  // Realtime broadcast: private channel walk:<match id> for live location.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    const sb = supabase();
    (async () => {
      try {
        await sb.realtime.setAuth();
      } catch {
        // Without auth the private channel is refused; the walk still works.
      }
      if (cancelled) return;
      channel = sb
        .channel(`walk:${matchId}`, { config: { private: true, broadcast: { self: false } } })
        .on("broadcast", { event: "location" }, (msg) => {
          const p = msg.payload as Partial<LivePoint> | undefined;
          if (p && typeof p.lat === "number" && typeof p.lng === "number") {
            setBuddyPos({ lat: p.lat, lng: p.lng, first_name: String(p.first_name ?? ""), at: String(p.at ?? "") });
          }
        })
        .subscribe((status) => {
          channelReady.current = status === "SUBSCRIBED";
          setChannelLive(status === "SUBSCRIBED");
        });
      channelRef.current = channel;
    })();
    return () => {
      cancelled = true;
      channelReady.current = false;
      channelRef.current = null;
      if (channel) void sb.removeChannel(channel);
    };
  }, [ready, matchId]);

  // Start sharing once, as soon as we know the walk is in progress.
  const walkInProgress = !!match && match.status !== "home_safe" && match.my_checkin !== "home_safe";
  useEffect(() => {
    if (!walkInProgress || autoStarted.current) return;
    autoStarted.current = true;
    const t = setTimeout(startSharing, 0);
    return () => clearTimeout(t);
  }, [walkInProgress, startSharing]);

  // Never leave a watch running after the screen closes.
  useEffect(
    () => () => {
      if (watchId.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId.current);
      }
    },
    [],
  );

  async function imHome() {
    setCheckingIn(true);
    setActionError(null);
    try {
      const { error } = await supabase().rpc("check_in", { p_match: matchId, p_trip: null, p_status: "home_safe" });
      if (error) throw error;
      stopSharing("off");
      await load();
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setCheckingIn(false);
    }
  }

  async function vouch() {
    setVouching(true);
    setActionError(null);
    try {
      const { error } = await supabase().rpc("vouch", { p_match: matchId });
      if (error) throw error;
      await load();
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setVouching(false);
    }
  }

  const markers = useMemo<MapMarker[]>(() => {
    if (!match) return [];
    const out: MapMarker[] = [];
    if (match.session_lat != null && match.session_lng != null) {
      out.push({ kind: "session", lat: match.session_lat, lng: match.session_lng, label: match.meeting_point ?? match.session_title });
    }
    out.push({ kind: "station", lat: match.my_station_lat, lng: match.my_station_lng, label: match.my_station });
    if (match.buddy_station !== match.my_station) {
      out.push({ kind: "station", lat: match.buddy_station_lat, lng: match.buddy_station_lng, label: match.buddy_station });
    }
    if (buddyPos) out.push({ kind: "buddy", lat: buddyPos.lat, lng: buddyPos.lng, label: match.buddy_first_name });
    if (myPos) out.push({ kind: "you", lat: myPos.lat, lng: myPos.lng, label: "You" });
    return out;
  }, [match, buddyPos, myPos]);

  // Fit to the fixed points only, so the map doesn't jump as you move.
  const fit = useMemo<MapPoint[]>(() => {
    if (!match) return [];
    const pts: MapPoint[] = [
      { lat: match.my_station_lat, lng: match.my_station_lng },
      { lat: match.buddy_station_lat, lng: match.buddy_station_lng },
    ];
    if (match.session_lat != null && match.session_lng != null) pts.push({ lat: match.session_lat, lng: match.session_lng });
    return pts;
  }, [match]);

  const route = useMemo(() => {
    if (!match || match.session_lat == null || match.session_lng == null) return undefined;
    const from = { lat: match.session_lat, lng: match.session_lng };
    const to = { lat: match.my_station_lat, lng: match.my_station_lng };
    const total = distanceM(from, to);
    let progress = 0;
    if (share === "arrived" || match.my_checkin === "home_safe") progress = 1;
    else if (myPos && total > 0) progress = Math.min(1, Math.max(0, 1 - distanceM(myPos, to) / total));
    return { from, to, progress };
  }, [match, myPos, share]);

  // ───── Render states ─────
  if (member.status === "error") {
    return (
      <Screen tabs={false}>
        <TopBack />
        <ErrorCard message={member.message} onRetry={member.reload} />
      </Screen>
    );
  }
  if (missing) {
    return (
      <Screen>
        <TopBack />
        <EmptyState
          title="This walk isn't available"
          body="It may have finished, or it isn't one of yours."
          action={<Button asChild variant="secondary" size="md"><Link href="/">Back to Tonight</Link></Button>}
        />
      </Screen>
    );
  }
  if (!match) {
    if (loadError) {
      return (
        <Screen tabs={false}>
          <TopBack />
          <ErrorCard message={loadError} onRetry={() => void load()} />
          <Button asChild variant="danger">
            <Link href={`/sos?match=${matchId}`}><Siren aria-hidden="true" /> SOS</Link>
          </Button>
        </Screen>
      );
    }
    return <LoadingScreen label="Loading your walk…" />;
  }

  const buddy = match.buddy_first_name;
  const bothHome = match.status === "home_safe";
  const iAmHome = match.my_checkin === "home_safe";
  const waitingForBuddy = iAmHome && !bothHome;
  const lines = trustLines(match.buddy_trust_reasons, match.buddy_safe_walks, `At ${match.session_title} with you tonight`);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-1 flex-col">
      {/* Map: top ~55% */}
      <div className="relative isolate h-[55dvh] min-h-[300px] w-full">
        <FlockMap
          markers={markers}
          fit={fit}
          route={route}
          height="100%"
          fitPadding={MAP_PAD}
          className="[&_.leaflet-bottom]:bottom-7!"
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[1001] flex items-start justify-between gap-2 px-4 pt-safe">
          <Link
            href="/"
            aria-label="Back to Tonight"
            className="pointer-events-auto inline-flex size-11 items-center justify-center rounded-full bg-ink/90 text-text shadow-lg active:bg-surface-2"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </Link>
          <LocationPill
            share={share}
            live={channelLive}
            onPause={() => stopSharing("paused")}
            onResume={startSharing}
          />
        </div>
      </div>

      {/* Bottom sheet, overlapping the map by 28px */}
      <section
        aria-label={`Walking home with ${buddy}`}
        className="relative z-10 -mt-7 flex flex-1 flex-col gap-5 rounded-t-[28px] border-t border-line bg-surface px-5 pt-3"
      >
        <span className="mx-auto h-1.5 w-10 rounded-full bg-surface-2" aria-hidden="true" />

        {share === "asking" && (
          <p className="rounded-[14px] bg-surface-2 px-4 py-3 text-[14px] text-muted" role="status">
            <MapPin className="mr-1 inline size-4 text-amber" aria-hidden="true" />
            So your group can see you until you reach the station. Location is never stored.
          </p>
        )}

        {chosen && !bothHome && !iAmHome && (
          <div className="flex items-center gap-2 rounded-[14px] border border-safe/40 bg-safe-tint px-4 py-3 text-[15px] font-semibold text-safe" role="status">
            <Sparkles className="size-5 shrink-0" aria-hidden="true" /> {buddy} chose to walk with you
          </div>
        )}

        <div className="flex items-end justify-between gap-3">
          <div>
            <Eyebrow>Matched in</Eyebrow>
            <p className="font-mono text-[44px] leading-none font-semibold text-amber">
              {match.seconds_to_match}
              <span className="ml-1 text-[20px] text-muted">{match.seconds_to_match === 1 ? "second" : "seconds"}</span>
            </p>
          </div>
          <p className="max-w-[9.5rem] text-right text-[13px] leading-snug text-muted">vs ~10 min asking a group chat</p>
        </div>

        {/* Status */}
        {bothHome ? (
          <div className="flex flex-col gap-3 rounded-[22px] border border-safe/40 bg-safe-tint p-5" role="status">
            <p className="flex items-center gap-2 text-[20px] font-extrabold text-safe">
              <PartyPopper className="size-6" aria-hidden="true" /> You&apos;re both home. Nice one.
            </p>
            <p className="text-[15px] text-text">Thanks for walking together. This counts as a safe walk for both of you.</p>
            {match.i_vouched ? (
              <p className="inline-flex items-center gap-2 text-[15px] font-semibold text-safe">
                <HandHeart className="size-5" aria-hidden="true" /> You vouched for {buddy}
              </p>
            ) : (
              <Button variant="secondary" onClick={vouch} disabled={vouching}>
                {vouching ? <Spinner /> : <HandHeart aria-hidden="true" />} Vouch for {buddy}
              </Button>
            )}
          </div>
        ) : waitingForBuddy ? (
          <div className="flex items-center gap-3 rounded-[18px] border border-line bg-surface-2 p-4" role="status">
            <Spinner className="text-safe" />
            <p className="text-[16px] font-semibold">You&apos;re checked in. Waiting for {buddy} to check in.</p>
          </div>
        ) : match.status === "missed_checkin" ? (
          <div className="flex items-start gap-3 rounded-[18px] border border-amber bg-amber-tint p-4" role="alert">
            <BellRing className="mt-0.5 size-5 shrink-0 text-amber" aria-hidden="true" />
            <p className="text-[16px] font-semibold">Your group has been nudged — tap I&apos;m home if you&apos;re safe.</p>
          </div>
        ) : match.status === "help" ? (
          <div className="flex items-start gap-3 rounded-[18px] border border-danger bg-danger-surface p-4" role="alert">
            <Siren className="mt-0.5 size-5 shrink-0 text-danger-soft" aria-hidden="true" />
            <p className="text-[16px] font-semibold">
              Your group and society safety lead have been alerted. In an emergency, call{" "}
              <a href="tel:999" className="font-extrabold text-danger-soft underline">999</a>.
            </p>
          </div>
        ) : null}

        {/* Buddy */}
        <div className="flex items-center gap-4">
          <Avatar name={buddy} size={56} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[22px] leading-tight font-extrabold">{buddy}</p>
            <div className="mt-1">
              <VerifiedBadge label={`Verified ${uniName(match.buddy_uni_domain)} student`} />
            </div>
          </div>
        </div>

        <ul className="flex flex-col gap-2 text-[15px]">
          {match.meeting_point && (
            <li className="flex items-center gap-2.5">
              <MapPin className="size-5 shrink-0 text-amber" aria-hidden="true" />
              <span>Meet at <span className="font-bold">{match.meeting_point}</span></span>
            </li>
          )}
          <li className="flex items-center gap-2.5">
            <TrainFront className="size-5 shrink-0 text-amber" aria-hidden="true" />
            <span>
              You → <span className="font-bold">{match.my_station}</span>
              {match.buddy_station !== match.my_station ? <> · {buddy} → <span className="font-bold">{match.buddy_station}</span></> : <> · same station</>}
            </span>
          </li>
          {match.buddy_leave_at && (
            <li className="flex items-center gap-2.5 text-muted">
              <span className="w-5" aria-hidden="true" />
              {buddy} leaves at <span className="font-mono font-semibold text-text">{hhmm(match.buddy_leave_at)}</span>
            </li>
          )}
        </ul>

        <hr className="border-line" />

        <div className="flex flex-col gap-3">
          <TrustList name={buddy} lines={lines} />
          <CogneeReason match={match} timedOut={reasonTimedOut} />
        </div>

        {!bothHome && (
          <div className="flex items-center justify-between gap-3 rounded-[16px] bg-surface-2 px-4 py-3">
            <span className="text-[15px] font-semibold">Check in by</span>
            <TimeChip>{hhmm(match.checkin_due_at)}</TimeChip>
          </div>
        )}

        {actionError && <ErrorCard message={actionError} />}

        <div className="flex justify-center">
          <Button variant="text" size="md" onClick={() => setReportOpen(true)}>
            <Flag aria-hidden="true" /> Report a problem
          </Button>
        </div>

        {/* Actions: I'm home + SOS always visible */}
        <div className="sticky bottom-0 -mx-5 mt-auto flex gap-3 border-t border-line bg-surface px-5 pt-3 pb-safe">
          {bothHome ? (
            <Button asChild variant="secondary" className="flex-1">
              <Link href="/">Back to Tonight</Link>
            </Button>
          ) : iAmHome ? (
            <div className="flex h-[54px] flex-1 items-center justify-center gap-2 rounded-[16px] bg-safe-tint text-[16px] font-bold text-safe">
              <House className="size-5" aria-hidden="true" /> You&apos;re home
            </div>
          ) : (
            <Button variant="safe" className="flex-1" onClick={imHome} disabled={checkingIn}>
              {checkingIn ? <Spinner /> : <House aria-hidden="true" />} I&apos;m home
            </Button>
          )}
          <Button asChild variant="danger" className="w-auto px-6">
            <Link href={`/sos?match=${matchId}`} aria-label="SOS: get help now">
              <Siren aria-hidden="true" /> SOS
            </Link>
          </Button>
        </div>
      </section>

      {reportOpen && <ReportSheet matchId={matchId} buddy={buddy} onClose={() => setReportOpen(false)} />}
    </main>
  );
}

function TopBack() {
  return (
    <div className="pt-4">
      <Link href="/" className="-ml-2 inline-flex min-h-11 items-center gap-1 px-2 text-[15px] font-semibold text-muted active:text-text">
        <ArrowLeft className="size-5" aria-hidden="true" /> Tonight
      </Link>
    </div>
  );
}

function LocationPill({ share, live, onPause, onResume }: { share: Share; live: boolean; onPause: () => void; onResume: () => void }) {
  const base = "pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-full bg-ink/90 px-4 text-[14px] font-bold shadow-lg";
  if (share === "sharing") {
    return (
      <button type="button" onClick={onPause} className={base} aria-label={live ? "Live: your group can see you. Tap to pause sharing" : "Connecting live location. Tap to pause"}>
        <span className={cn("size-2 rounded-full", live ? "bg-safe" : "bg-amber")} aria-hidden="true" />
        {live ? "Live · group can see you" : "Connecting…"}
      </button>
    );
  }
  if (share === "paused") {
    return (
      <button type="button" onClick={onResume} className={cn(base, "text-muted")}>
        <span className="size-2 rounded-full bg-muted" aria-hidden="true" /> Paused · tap to share
      </button>
    );
  }
  if (share === "asking") {
    return (
      <span className={cn(base, "text-muted")} role="status">
        <Spinner className="size-4" /> Finding you…
      </span>
    );
  }
  const label = share === "arrived" ? "Sharing stopped at the station" : "Location off";
  return (
    <span className={cn(base, "text-muted")} role="status">
      <span className="size-2 rounded-full bg-muted" aria-hidden="true" /> {label}
    </span>
  );
}

function CogneeReason({ match, timedOut }: { match: MyMatch; timedOut: boolean }) {
  if (match.reason) {
    return (
      <div className="rounded-[16px] border border-line bg-surface-2 p-4">
        <p className="text-[15px] leading-snug font-semibold">{match.reason}</p>
        <p className="mt-1 text-[12px] font-semibold text-muted">From your community&apos;s walk history (Cognee)</p>
      </div>
    );
  }
  if (match.reason_source === "unavailable" || (match.reason_source === null && timedOut)) {
    return (
      <div>
        <FallbackLabel>Cognee reason unavailable</FallbackLabel>
      </div>
    );
  }
  return (
    <p className="inline-flex items-center gap-2 text-[14px] font-semibold text-muted" role="status">
      <Spinner className="size-4" /> Checking walk history…
    </p>
  );
}

// ───────────── Report sheet ─────────────

const KINDS = [
  { value: "behaviour", label: "Behaviour", hint: "Something they said or did" },
  { value: "scam", label: "Scam", hint: "Asked for money, links or details" },
  { value: "place", label: "Place", hint: "A street or spot that felt unsafe" },
] as const;

function ReportSheet({ matchId, buddy, onClose }: { matchId: string; buddy: string; onClose: () => void }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("behaviour");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tooShort = evidence.trim().length < 10;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (tooShort) return;
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase().rpc("file_report", { p_match: matchId, p_kind: kind, p_evidence: evidence.trim() });
      if (error) throw error;
      setDone(true);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center">
      <button type="button" aria-label="Close report" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        className="relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] border-t border-line bg-surface px-5 pt-5 pb-safe"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="report-title" className="text-[22px] font-extrabold tracking-[-0.02em]">Report a problem</h2>
          <Button ref={closeRef} variant="chip" size="icon" onClick={onClose} aria-label="Close">
            <X aria-hidden="true" />
          </Button>
        </div>

        {done ? (
          <div className="flex flex-col gap-4 py-6" role="status">
            <p className="text-[17px] font-bold">Thanks. Your report is with your society.</p>
            <p className="text-[15px] text-muted">A human from your society reviews every report. Grok Bot only recommends.</p>
            <Button onClick={onClose}>Done</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-4 flex flex-col gap-5">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[13px] font-semibold text-muted">What happened?</legend>
              {KINDS.map((k) => (
                <label
                  key={k.value}
                  className={cn(
                    "flex min-h-14 cursor-pointer items-center gap-3 rounded-[14px] border px-4 py-3",
                    kind === k.value ? "border-amber bg-amber-tint" : "border-line-strong",
                  )}
                >
                  <input
                    type="radio"
                    name="kind"
                    value={k.value}
                    checked={kind === k.value}
                    onChange={() => setKind(k.value)}
                    className="size-5 accent-[#F7B538]"
                  />
                  <span>
                    <span className="block text-[16px] font-bold">{k.label}</span>
                    <span className="block text-[13px] text-muted">{k.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="flex flex-col gap-2">
              <label htmlFor="evidence" className="text-[13px] font-semibold text-muted">
                What did you see? {kind !== "place" && <>This report is about your walk with {buddy}.</>}
              </label>
              <textarea
                id="evidence"
                required
                minLength={10}
                rows={4}
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                placeholder="Describe what happened, when and where."
                className="rounded-[14px] border border-line-strong bg-ink px-4 py-3 text-[16px] text-text placeholder:text-muted/70 focus:border-amber focus:outline-none"
              />
              <p className={cn("text-[13px]", tooShort ? "text-muted" : "text-safe")}>
                {tooShort ? `At least 10 characters (${evidence.trim().length}/10)` : "Thanks, that's enough detail."}
              </p>
            </div>

            <p className="text-[14px] text-muted">A human from your society reviews every report. Grok Bot only recommends.</p>

            {error && <ErrorCard message={error} />}

            <Button type="submit" disabled={busy || tooShort}>
              {busy ? <Spinner /> : null} Send report
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
