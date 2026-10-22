"use client";

// Shared pieces for the Tonight, Sessions, Session detail and Groups screens.
// Supabase: every read is an RPC that runs under the user's JWT (RLS + auth.uid()).

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/flock";
import { supabase } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { dayLabel, hhmm } from "@/lib/format";
import type { SessionOverview } from "@/lib/types";
import { cn } from "@/lib/utils";

type RpcState<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

/**
 * Calls a Supabase RPC once `enabled` is true. `refresh()` reloads quietly
 * (keeps the current data on screen, for polling); `retry()` shows the loading state again.
 */
export function useRpc<T>(name: string, args: Record<string, unknown> | null, enabled: boolean) {
  const [state, setState] = useState<RpcState<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const argsKey = JSON.stringify(args ?? {});

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase().rpc(name, JSON.parse(argsKey) as Record<string, unknown>);
        if (error) throw error;
        if (!cancelled) setState({ status: "ready", data: data as T });
      } catch (e) {
        if (!cancelled) setState({ status: "error", message: friendlyError(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [name, argsKey, enabled, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const retry = useCallback(() => {
    setState({ status: "loading" });
    setNonce((n) => n + 1);
  }, []);
  const setData = useCallback((fn: (d: T) => T) => {
    setState((s) => (s.status === "ready" ? { status: "ready", data: fn(s.data) } : s));
  }, []);

  return { state, refresh, retry, setData };
}

/** Current time, re-read every `ms` so "ends in N min" labels stay fresh. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Re-runs `fn` every `ms` while mounted. */
export function useInterval(fn: () => void, ms: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }, [fn, ms, enabled]);
}

/** Marks a session as joined locally after join_session succeeds. */
export function markJoined(rows: SessionOverview[], id: string, firstName: string): SessionOverview[] {
  return rows.map((s) =>
    s.id === id && !s.joined
      ? { ...s, joined: true, member_count: Number(s.member_count) + 1, member_names: [...s.member_names, firstName] }
      : s,
  );
}

export function LumaTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[12px] font-semibold text-muted">
      <CalendarDays className="size-3.5" aria-hidden="true" /> Luma · Hack Collective
    </span>
  );
}

/** Calls join_session. Shows its own loading and error state. */
export function JoinButton({
  sessionId,
  title,
  onJoined,
  size = "sm",
  variant = "chip",
  className,
}: {
  sessionId: string;
  title: string;
  onJoined: () => void;
  size?: "sm" | "lg";
  variant?: "chip" | "primary" | "secondary";
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase().rpc("join_session", { p_session: sessionId });
      if (error) throw error;
      onJoined();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("flex flex-col items-end gap-1", size === "lg" && "items-stretch", className)}>
      <Button type="button" variant={variant} size={size} onClick={join} disabled={busy} aria-label={size === "sm" ? `Join ${title}` : undefined}>
        {busy && <Spinner className="size-4" />} Join{size === "lg" ? " this session" : ""}
      </Button>
      {error && (
        <p role="alert" className="max-w-[220px] text-right text-[13px] font-semibold text-amber">
          {error}
        </p>
      )}
    </div>
  );
}

export function JoinedTag() {
  return (
    <span className="inline-flex h-11 items-center gap-1 px-1 text-[14px] font-bold text-safe">
      <Check className="size-4" aria-hidden="true" /> Joined
    </span>
  );
}

/** Event row: time in amber mono, title + venue, Join button (design.md section 5). */
export function EventRow({
  session,
  firstName,
  onJoined,
  dim,
  showDay,
}: {
  session: SessionOverview;
  firstName: string;
  onJoined: (id: string, firstName: string) => void;
  dim?: boolean;
  showDay?: boolean;
}) {
  return (
    <li className={cn("flex items-center gap-3 border-b border-line py-3 last:border-b-0", dim && "opacity-70")}>
      <Link href={`/sessions/${session.id}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[12px] active:bg-surface-2/60">
        <span className="w-[52px] shrink-0 text-center">
          <span className="block font-mono text-[17px] font-semibold text-amber">{hhmm(session.ends_at)}</span>
          <span className="block text-[12px] font-semibold text-muted">ends</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-bold">{session.title}</span>
          <span className="block truncate text-[14px] text-muted">
            {showDay && `${dayLabel(session.ends_at)} · `}
            {session.location_name || session.community_name}
            {session.member_count > 0 && (
              <>
                {" · "}
                <span className="font-mono">{session.member_count}</span> going
              </>
            )}
          </span>
          {session.source === "luma" && (
            <span className="mt-1 block">
              <LumaTag />
            </span>
          )}
        </span>
      </Link>
      {dim ? null : session.joined ? (
        <JoinedTag />
      ) : (
        <JoinButton sessionId={session.id} title={session.title} onJoined={() => onJoined(session.id, firstName)} />
      )}
    </li>
  );
}
