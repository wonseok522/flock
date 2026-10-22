"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Plus } from "lucide-react";
import { Screen, ScreenTitle } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorCard, Eyebrow, LoadingScreen, Skeleton } from "@/components/flock";
import { useMember } from "@/lib/use-member";
import type { SessionOverview } from "@/lib/types";
import { EventRow, markJoined, useInterval, useNow, useRpc } from "./shared";

const TONIGHT_MS = 12 * 60 * 60 * 1000;

function Group({
  title,
  rows,
  firstName,
  onJoined,
  dim,
  showDay,
}: {
  title: string;
  rows: SessionOverview[];
  firstName: string;
  onJoined: (id: string, name: string) => void;
  dim?: boolean;
  showDay?: boolean;
}) {
  if (rows.length === 0) return null;
  const id = `group-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id}>
      <Eyebrow>
        <span id={id}>{title}</span>
      </Eyebrow>
      <ul className="mt-2 rounded-[22px] border border-line bg-surface px-4">
        {rows.map((s) => (
          <EventRow key={s.id} session={s} firstName={firstName} onJoined={onJoined} dim={dim} showDay={showDay} />
        ))}
      </ul>
    </section>
  );
}

export function SessionsScreen() {
  const member = useMember();
  const ready = member.status === "ready";
  const sessions = useRpc<SessionOverview[]>("sessions_overview", null, ready);
  const now = useNow();
  useInterval(sessions.refresh, 30_000, ready);

  const groups = useMemo(() => {
    const empty = { tonight: [] as SessionOverview[], later: [] as SessionOverview[], ended: [] as SessionOverview[] };
    if (sessions.state.status !== "ready") return empty;
    for (const s of sessions.state.data) {
      const ms = new Date(s.ends_at).getTime() - now;
      if (ms <= 0) empty.ended.push(s);
      else if (ms < TONIGHT_MS) empty.tonight.push(s);
      else empty.later.push(s);
    }
    empty.ended.reverse();
    return empty;
  }, [sessions.state, now]);

  if (member.status === "loading") return <LoadingScreen />;

  const newButton = (
    <Button asChild size="sm" variant="primary">
      <Link href="/sessions/new">
        <Plus aria-hidden="true" /> New session
      </Link>
    </Button>
  );

  return (
    <Screen>
      <div className="flex items-start justify-between gap-3">
        <ScreenTitle sub="Join one so you can get home together when it ends.">Sessions</ScreenTitle>
        <div className="shrink-0 pt-8">{newButton}</div>
      </div>

      {member.status === "error" ? (
        <ErrorCard message={member.message} onRetry={member.reload} />
      ) : sessions.state.status === "loading" ? (
        <div className="flex flex-col gap-3" role="status" aria-live="polite">
          <span className="sr-only">Loading sessions…</span>
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : sessions.state.status === "error" ? (
        <ErrorCard message={sessions.state.message} onRetry={sessions.retry} />
      ) : groups.tonight.length + groups.later.length + groups.ended.length === 0 ? (
        <EmptyState
          title="No sessions yet"
          body="Studying late? Create a session so others can join and walk home with you."
          action={
            <Button asChild>
              <Link href="/sessions/new">
                <Plus aria-hidden="true" /> Create a session
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          {groups.tonight.length === 0 && (
            <EmptyState title="Nothing on tonight yet" body="Create a session and your community can join." />
          )}
          <Group
            title="Tonight"
            rows={groups.tonight}
            firstName={member.member.first_name}
            onJoined={(id, name) => {
              sessions.setData((rows) => markJoined(rows, id, name));
              sessions.refresh();
            }}
          />
          <Group
            title="Later"
            rows={groups.later}
            showDay
            firstName={member.member.first_name}
            onJoined={(id, name) => {
              sessions.setData((rows) => markJoined(rows, id, name));
              sessions.refresh();
            }}
          />
          <Group title="Ended earlier" rows={groups.ended} dim firstName={member.member.first_name} onJoined={() => undefined} />
        </>
      )}
    </Screen>
  );
}
