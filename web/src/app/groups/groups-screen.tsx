"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, ShieldCheck, Users } from "lucide-react";
import { Screen, ScreenTitle } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, ErrorCard, LoadingScreen, PrivacyNote, Skeleton, TimeChip, VerifiedBadge } from "@/components/flock";
import { useMember } from "@/lib/use-member";
import { relativeEnd } from "@/lib/format";
import type { Community } from "@/lib/types";
import { useRpc } from "../sessions/shared";

function domainLabel(domains: string[]): string {
  if (domains.length === 0) return "Verified";
  const shown = domains.slice(0, 2).join(", ");
  return `Verified · ${shown}${domains.length > 2 ? ` +${domains.length - 2}` : ""}`;
}

function CommunityCard({ c }: { c: Community }) {
  const count = Number(c.member_count);
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[21px] leading-tight font-extrabold tracking-[-0.01em]">{c.name}</h2>
          {c.role === "lead" && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-amber-tint px-2.5 py-1 text-[12px] font-bold text-amber">Safety lead</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <VerifiedBadge label={domainLabel(c.domains)} />
          <span className="inline-flex items-center gap-1.5 text-[14px] text-muted">
            <Users className="size-4" aria-hidden="true" />
            <span className="font-mono font-semibold text-text">{count}</span> {count === 1 ? "member" : "members"}
          </span>
        </div>
      </div>

      <div className="rounded-[16px] bg-surface-2 px-4 py-3">
        <p className="text-[12px] font-bold tracking-[0.06em] text-muted uppercase">Next session</p>
        {c.next_session_title && c.next_session_ends_at ? (
          <div className="mt-1 flex items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2 text-[16px] font-bold">
              <CalendarDays className="size-4 shrink-0 text-amber" aria-hidden="true" />
              <span className="truncate">{c.next_session_title}</span>
            </p>
            <TimeChip>{relativeEnd(c.next_session_ends_at)}</TimeChip>
          </div>
        ) : (
          <p className="mt-1 text-[15px] text-muted">Nothing scheduled. Start one from Sessions.</p>
        )}
      </div>

      {c.role === "lead" && (
        <Button asChild variant="secondary">
          <Link href="/dashboard">
            <ShieldCheck aria-hidden="true" /> Open Safety HQ <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      )}
    </Card>
  );
}

export function GroupsScreen() {
  const member = useMember();
  const communities = useRpc<Community[]>("my_communities", null, member.status === "ready");

  if (member.status === "loading") return <LoadingScreen />;

  return (
    <Screen>
      <ScreenTitle sub="Verified-only spaces. Everyone here signed in with a university email.">Groups</ScreenTitle>

      {member.status === "error" ? (
        <ErrorCard message={member.message} onRetry={member.reload} />
      ) : communities.state.status === "loading" ? (
        <div className="flex flex-col gap-4" role="status" aria-live="polite">
          <span className="sr-only">Loading your groups…</span>
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : communities.state.status === "error" ? (
        <ErrorCard message={communities.state.message} onRetry={communities.retry} />
      ) : communities.state.data.length === 0 ? (
        <EmptyState
          title="You're not in a verified group yet"
          body="Groups unlock automatically from your university email domain. Ask your society lead to add your university."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {communities.state.data.map((c) => (
            <CommunityCard key={c.id} c={c} />
          ))}
        </div>
      )}

      <PrivacyNote>Outsiders can&apos;t join: membership is checked against your university email, and blocked accounts are shared across communities.</PrivacyNote>
    </Screen>
  );
}
