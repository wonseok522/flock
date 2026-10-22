"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Eye, EyeOff, Footprints, MapPin, Radio, Timer, Users } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Screen } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Avatar, Card, EmptyState, ErrorCard, Eyebrow, LoadingScreen, PrivacyNote, Skeleton, TimeChip } from "@/components/flock";
import { FlockMap, type MapMarker } from "@/components/map";
import { useMember } from "@/lib/use-member";
import { supabase } from "@/lib/supabase/client";
import { hhmm, relativeEnd } from "@/lib/format";
import type { SessionOverview, SessionWalk } from "@/lib/types";
import { cn } from "@/lib/utils";
import { JoinButton, LumaTag, markJoined, useInterval, useNow, useRpc } from "../shared";

type LivePoint = { first_name: string; lat: number; lng: number; at: string };
type ChannelStatus = "connecting" | "live" | "error";

function isLivePoint(p: unknown): p is LivePoint {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return typeof o.first_name === "string" && typeof o.lat === "number" && typeof o.lng === "number" && typeof o.at === "string";
}

/**
 * Subscribes to the private Realtime broadcast channel `walk:<match_id>`.
 * Locations are never stored; RLS on realtime.messages (can_watch_topic)
 * only lets session members listen. Unsubscribes on unmount.
 */
function LiveWatcher({
  matchId,
  onPoint,
  onStatus,
}: {
  matchId: string;
  onPoint: (matchId: string, p: LivePoint) => void;
  onStatus: (matchId: string, s: ChannelStatus) => void;
}) {
  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    const sb = supabase();
    (async () => {
      try {
        await sb.realtime.setAuth();
        if (cancelled) return;
        channel = sb
          .channel(`walk:${matchId}`, { config: { private: true } })
          .on("broadcast", { event: "location" }, ({ payload }) => {
            if (isLivePoint(payload)) onPoint(matchId, payload);
          })
          .subscribe((status) => {
            if (status === "SUBSCRIBED") onStatus(matchId, "live");
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onStatus(matchId, "error");
          });
      } catch {
        if (!cancelled) onStatus(matchId, "error");
      }
    })();
    return () => {
      cancelled = true;
      if (channel) void sb.removeChannel(channel);
    };
  }, [matchId, onPoint, onStatus]);
  return null;
}

function StatusChip({ status }: { status: SessionWalk["status"] }) {
  const s =
    status === "active"
      ? { label: "Walking", cls: "bg-amber-tint text-amber", dot: "bg-amber" }
      : status === "home_safe"
        ? { label: "Home safe", cls: "bg-safe-tint text-safe", dot: "bg-safe" }
        : { label: "Needs check", cls: "bg-danger-surface text-danger-soft", dot: "bg-danger" };
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-bold", s.cls)}>
      <span className={cn("size-2 rounded-full", s.dot)} aria-hidden="true" /> {s.label}
    </span>
  );
}

function WalkingHome({ session }: { session: SessionOverview }) {
  const walks = useRpc<SessionWalk[]>("session_walks", { p_session: session.id }, true);
  useInterval(walks.refresh, 10_000);
  const [watching, setWatching] = useState<Record<string, boolean>>({});
  const [points, setPoints] = useState<Record<string, Record<string, LivePoint>>>({});
  const [channelStatus, setChannelStatus] = useState<Record<string, ChannelStatus>>({});

  const onPoint = useCallback((matchId: string, p: LivePoint) => {
    setPoints((prev) => ({ ...prev, [matchId]: { ...prev[matchId], [p.first_name]: p } }));
  }, []);
  const onStatus = useCallback((matchId: string, s: ChannelStatus) => {
    setChannelStatus((prev) => ({ ...prev, [matchId]: s }));
  }, []);

  function toggle(matchId: string) {
    setWatching((prev) => ({ ...prev, [matchId]: !prev[matchId] }));
    setChannelStatus((prev) => ({ ...prev, [matchId]: "connecting" }));
    setPoints((prev) => {
      const next = { ...prev };
      delete next[matchId];
      return next;
    });
  }

  const rows = walks.state.status === "ready" ? walks.state.data : [];
  const watched = rows.filter((w) => w.status === "active" && watching[w.match_id]);

  const markers: MapMarker[] = [];
  if (session.lat != null && session.lng != null) markers.push({ lat: session.lat, lng: session.lng, kind: "session", label: session.title });
  for (const w of watched) {
    for (const p of Object.values(points[w.match_id] ?? {})) markers.push({ lat: p.lat, lng: p.lng, kind: "buddy", label: p.first_name });
  }
  const livePoints = markers.filter((m) => m.kind === "buddy").length;

  return (
    <section aria-labelledby="walking-home" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Eyebrow>
          <span id="walking-home">Walking home now</span>
        </Eyebrow>
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-muted">
          <span className="size-2 rounded-full bg-safe motion-safe:animate-pulse" aria-hidden="true" /> updates every 10 s
        </span>
      </div>

      {walks.state.status === "loading" ? (
        <Skeleton className="h-20" />
      ) : walks.state.status === "error" ? (
        <ErrorCard message={walks.state.message} onRetry={walks.retry} />
      ) : rows.length === 0 ? (
        <EmptyState title="Nobody's walking yet" body="When people in this session pair up, you'll see them here until they're home." />
      ) : (
        <>
          <ul className="rounded-[22px] border border-line bg-surface px-4">
            {rows.map((w) => {
              const on = Boolean(watching[w.match_id]) && w.status === "active";
              const cs = channelStatus[w.match_id];
              return (
                <li key={w.match_id} className="flex flex-col gap-2 border-b border-line py-3 last:border-b-0">
                  <div className="flex items-center gap-3">
                    <span className="flex shrink-0 items-center">
                      {w.first_names.map((n, i) => (
                        <span key={`${n}-${i}`} className={i ? "-ml-2" : ""}>
                          <Avatar name={n} size={32} ring="ring-2 ring-surface" />
                        </span>
                      ))}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px] font-bold">{w.first_names.join(" & ")}</span>
                      <span className="block truncate text-[14px] text-muted">
                        to {Array.from(new Set(w.station_names)).join(" / ")} · <span className="font-mono">{hhmm(w.created_at)}</span>
                      </span>
                    </span>
                    <StatusChip status={w.status} />
                  </div>
                  {w.status === "active" && (
                    <div className="flex items-center justify-between gap-3 pl-[52px]">
                      <span className="text-[13px] text-muted">
                        {on ? (cs === "error" ? "Can't watch live right now" : cs === "live" ? "Watching live" : "Connecting…") : "Live until they reach their station."}
                      </span>
                      <Button type="button" variant="chip" size="sm" aria-pressed={on} onClick={() => toggle(w.match_id)}>
                        {on ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                        {on ? "Stop watching" : "Watch live"}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {watched.map((w) => (
            <LiveWatcher key={w.match_id} matchId={w.match_id} onPoint={onPoint} onStatus={onStatus} />
          ))}
          {watched.length > 0 && (
            <div className="overflow-hidden rounded-[18px] border border-line">
              <FlockMap height={240} markers={markers} />
              <p className="flex items-center gap-2 bg-surface px-4 py-3 text-[13px] text-muted">
                <Radio className="size-4 shrink-0 text-safe" aria-hidden="true" />
                {livePoints === 0
                  ? "Waiting for their next location. Sharing stops at their station."
                  : "Live until they reach their station. Never stored."}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function SessionScreen() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const member = useMember();
  const ready = member.status === "ready";
  const sessions = useRpc<SessionOverview[]>("sessions_overview", null, ready);
  const now = useNow();
  useInterval(sessions.refresh, 30_000, ready);

  const back = (
    <div className="pt-4">
      <Link href="/sessions" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 px-2 text-[15px] font-bold text-muted active:text-text">
        <ArrowLeft className="size-5" aria-hidden="true" /> Sessions
      </Link>
    </div>
  );

  if (member.status === "loading") return <LoadingScreen />;
  if (member.status === "error") {
    return (
      <Screen>
        {back}
        <ErrorCard message={member.message} onRetry={member.reload} />
      </Screen>
    );
  }
  if (sessions.state.status === "loading") return <LoadingScreen label="Loading session…" />;
  if (sessions.state.status === "error") {
    return (
      <Screen>
        {back}
        <ErrorCard message={sessions.state.message} onRetry={sessions.retry} />
      </Screen>
    );
  }

  const s = sessions.state.data.find((x) => x.id === id);
  if (!s) {
    return (
      <Screen>
        {back}
        <EmptyState
          title="Session not found"
          body="It may have ended more than 3 hours ago, or it belongs to a community you're not in."
          action={
            <Button asChild variant="secondary">
              <Link href="/sessions">See all sessions</Link>
            </Button>
          }
        />
      </Screen>
    );
  }

  const count = Number(s.member_count);
  const ended = new Date(s.ends_at).getTime() < now;
  const hidden = count - s.member_names.length;

  return (
    <Screen>
      {back}
      <Card highlight={s.joined} className="flex flex-col gap-4 rounded-[24px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>{s.joined ? "Your session" : s.community_name}</Eyebrow>
          <TimeChip>{relativeEnd(s.ends_at)}</TimeChip>
        </div>
        <div>
          <h1 className="text-[26px] leading-tight font-extrabold tracking-[-0.02em]">{s.title}</h1>
          {s.location_name && (
            <p className="mt-1 flex items-center gap-1.5 text-[15px] text-muted">
              <MapPin className="size-4 shrink-0" aria-hidden="true" /> {s.location_name}
            </p>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[14px] text-muted">
            <Users className="size-4 shrink-0" aria-hidden="true" /> {s.community_name}
            {s.source === "luma" && <LumaTag />}
          </p>
        </div>
        {s.lat != null && s.lng != null && (
          <div className="overflow-hidden rounded-[16px] border border-line">
            <FlockMap height={160} markers={[{ lat: s.lat, lng: s.lng, kind: "session", label: s.location_name ?? s.title }]} />
          </div>
        )}

        <div>
          <p className="text-[14px] text-muted">
            <span className="font-mono font-semibold text-text">{count}</span> {count === 1 ? "person" : "people"} in this session
          </p>
          {s.member_names.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="People in this session">
              {s.member_names.map((n, i) => (
                <li key={`${n}-${i}`} className="inline-flex items-center gap-2 rounded-full bg-surface-2 py-1 pr-3 pl-1 text-[14px] font-semibold">
                  <Avatar name={n} size={26} /> {n}
                </li>
              ))}
              {hidden > 0 && (
                <li className="inline-flex items-center rounded-full bg-surface-2 px-3 py-1 font-mono text-[14px] font-semibold text-muted">+{hidden}</li>
              )}
            </ul>
          )}
        </div>

        {ended ? (
          <p className="text-[15px] font-semibold text-muted">This session ended at <span className="font-mono">{hhmm(s.ends_at)}</span>.</p>
        ) : s.joined ? (
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
        ) : (
          <div className="flex flex-col gap-2.5">
            <JoinButton
              sessionId={s.id}
              title={s.title}
              size="lg"
              variant="primary"
              onJoined={() => {
                sessions.setData((rows) => markJoined(rows, s.id, member.member.first_name));
                sessions.refresh();
              }}
            />
            <p className="text-center text-[13px] text-muted">Join to find a walk buddy from this session when it ends.</p>
          </div>
        )}
      </Card>

      {s.joined ? (
        <WalkingHome session={s} />
      ) : (
        <PrivacyNote>Only people in this session can see who&apos;s walking home and where.</PrivacyNote>
      )}
      <PrivacyNote>Flock uses stations, never home addresses. Everyone sees first names only.</PrivacyNote>
    </Screen>
  );
}
