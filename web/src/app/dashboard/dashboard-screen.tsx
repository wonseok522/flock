"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  BellRing,
  BookOpen,
  CalendarDays,
  Check,
  ExternalLink,
  Flag,
  Footprints,
  Gauge,
  LayoutDashboard,
  MessageCircle,
  Phone,
  ShieldBan,
  ShieldCheck,
  Siren,
  Sparkles,
  TrainFront,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, EmptyState, ErrorCard, Eyebrow, Logo, Skeleton, Spinner } from "@/components/flock";
import { hhmm } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DashboardData, DashboardIncident, DecideAction } from "./types";

// Society Safety HQ (design screen 7). Lead-only. Data from /api/dashboard
// (Supabase service role after a lead check), refreshed every 5 s. Incidents
// link to their Notion page; Grok Bot's recommendation is shown, and a human
// lead makes every decision.

const REFRESH_MS = 5000;

type Load =
  | { status: "loading" }
  | { status: "denied"; code: 401 | 403 }
  | { status: "error"; message: string }
  | { status: "ready"; data: DashboardData; refreshError: string | null };

function hhmmss(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(
    new Date(iso),
  );
}

function baselineLabel(s: number): string {
  return s >= 60 ? `~${Math.round(s / 60)} min` : `~${s} s`;
}

function kindInfo(i: DashboardIncident): { label: string; Icon: typeof BellRing; urgent: boolean } {
  if (i.kind === "missed_checkin") return { label: "Missed check-in", Icon: BellRing, urgent: true };
  if (i.kind === "help") return { label: "SOS", Icon: Siren, urgent: true };
  return { label: i.report ? `Report · ${i.report.kind}` : "Report", Icon: Flag, urgent: false };
}

function StatTile({ label, value, Icon, danger, sub }: { label: string; value: ReactNode; Icon: typeof BellRing; danger?: boolean; sub?: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-[20px] border p-4 lg:p-5", danger ? "border-danger bg-danger-surface" : "border-line bg-surface")}>
      <p className={cn("flex items-center gap-2 text-[14px] leading-tight font-bold", danger ? "text-danger-soft" : "text-muted")}>
        <Icon className="size-4 shrink-0" aria-hidden="true" /> {label}
      </p>
      <p className="font-mono text-[44px] leading-none font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-[13px] text-muted">{sub}</p>}
    </div>
  );
}

function IncidentCard({ incident, onDecided }: { incident: DashboardIncident; onDecided: () => void }) {
  const [busy, setBusy] = useState<DecideAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { label, Icon, urgent } = kindInfo(incident);
  const open = incident.status === "open";
  const names = incident.first_names.length ? incident.first_names : ["Unknown"];
  const calling = incident.resolution === "Lead is calling";

  async function decide(action: DecideAction) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incident_id: incident.id, action }),
        signal: AbortSignal.timeout(10000),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? "Couldn't save that decision. Try again.");
      setConfirming(false);
      onDecided();
    } catch (e) {
      setError(e instanceof Error && e.name !== "TimeoutError" ? e.message : "Couldn't reach Flock. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article
      className={cn(
        "flex flex-col gap-4 rounded-[22px] border p-5",
        !open ? "border-line bg-surface opacity-80" : urgent ? "border-danger bg-danger-surface" : "border-line-strong bg-surface",
      )}
    >
      <header className="flex flex-wrap items-center gap-3">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[14px] font-extrabold",
            urgent && open ? "bg-danger text-white" : "bg-surface-2 text-text",
          )}
        >
          <Icon className="size-4" aria-hidden="true" /> {label}
        </span>
        <span className={cn("inline-flex items-center gap-1.5 text-[14px] font-bold", open ? "text-danger-soft" : "text-safe")}>
          <span className={cn("size-2 rounded-full", open ? "bg-danger" : "bg-safe")} aria-hidden="true" />
          {open ? (calling ? "Open · lead is calling" : "Open") : "Resolved"}
        </span>
        <span className="ml-auto font-mono text-[15px] text-muted">{hhmm(incident.created_at)}</span>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center">
          {names.slice(0, 3).map((n, i) => (
            <span key={`${n}-${i}`} className={i ? "-ml-2" : ""}>
              <Avatar name={n} size={32} ring="ring-2 ring-surface" />
            </span>
          ))}
        </span>
        <p className="text-[20px] font-extrabold">{names.join(" & ")}</p>
        {incident.session_title && <p className="text-[15px] text-muted">at {incident.session_title}</p>}
      </div>
      {incident.detail && (
        <p className="-mt-2 flex items-center gap-2 text-[15px] font-semibold">
          <TrainFront className="size-4 shrink-0 text-amber" aria-hidden="true" /> {incident.detail}
        </p>
      )}

      {incident.report && (
        <blockquote className="rounded-[14px] border border-line bg-ink/40 p-3 text-[15px]">
          <p>&ldquo;{incident.report.evidence}&rdquo;</p>
          <footer className="mt-1 text-[13px] text-muted">
            {incident.report.reporter_first_name ? `Reported by ${incident.report.reporter_first_name}` : "Reported by a member"} · {incident.report.status}
          </footer>
        </blockquote>
      )}

      {/* Timeline: created → Discord alerted → Notion page */}
      <ol className="flex flex-col gap-2 text-[14px] md:flex-row md:flex-wrap md:items-center md:gap-x-5" aria-label="Timeline">
        <li className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-amber" aria-hidden="true" />
          Created <span className="font-mono font-semibold">{hhmm(incident.created_at)}</span>
        </li>
        <li className="flex items-center gap-2">
          <MessageCircle className={cn("size-4", incident.alerted_at ? "text-safe" : "text-muted")} aria-hidden="true" />
          {incident.alerted_at ? (
            <>
              Discord alerted <span className="font-mono font-semibold">{hhmm(incident.alerted_at)}</span>
            </>
          ) : (
            <span className="text-muted">{open ? "Discord alert pending" : "No Discord alert sent"}</span>
          )}
        </li>
        <li className="flex items-center gap-2">
          <BookOpen className={cn("size-4", incident.notion_url ? "text-safe" : "text-muted")} aria-hidden="true" />
          {incident.notion_url ? (
            <a href={incident.notion_url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 font-bold text-amber underline underline-offset-4">
              Open in Notion <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          ) : (
            <span className="text-muted">{open ? "Notion page pending" : "No Notion page"}</span>
          )}
        </li>
        {incident.resolution && (
          <li className="flex items-center gap-2">
            <Check className="size-4 text-safe" aria-hidden="true" /> {incident.resolution}
          </li>
        )}
      </ol>

      {/* Grok Bot recommendation: a human decides */}
      {!open && !incident.grok_recommendation ? (
        <p className="flex items-center gap-2 text-[14px] text-muted">
          <Sparkles className="size-4 shrink-0" aria-hidden="true" /> Resolved before Grok Bot&apos;s review. A human decided.
        </p>
      ) : (
        <section className="rounded-[18px] border border-amber bg-ink/40 p-4" aria-label="Grok Bot recommendation">
          <p className="flex items-center gap-2 text-[13px] font-extrabold tracking-[0.06em] text-amber uppercase">
            <Sparkles className="size-4" aria-hidden="true" /> Grok Bot recommends
          </p>
          {incident.grok_recommendation ? (
            <p className="mt-2 text-[16px] whitespace-pre-line">{incident.grok_recommendation}</p>
          ) : (
            <p className="mt-2 text-[16px] text-muted">Waiting for Grok Bot&apos;s review in Notion</p>
          )}
          <p className="mt-3 text-[13px] font-semibold text-muted">A human decides. Grok Bot only recommends.</p>
        </section>
      )}

      {open && (
        <div className="flex flex-col gap-3">
          {incident.kind === "report" ? (
            incident.report?.status === "pending" || !incident.report ? (
              confirming ? (
                <div className="flex flex-col gap-3 rounded-[16px] border border-line-strong p-4" role="alertdialog" aria-label="Confirm block">
                  <p className="text-[15px] font-semibold">
                    Block {names[0]} from Flock in every community? Only a hash of their email goes on the shared blocklist.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="md" onClick={() => decide("confirm_block")} disabled={busy !== null}>
                      {busy === "confirm_block" ? <Spinner /> : <ShieldBan aria-hidden="true" />} Yes, block
                    </Button>
                    <Button variant="secondary" size="md" onClick={() => setConfirming(false)} disabled={busy !== null}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {incident.report?.about_member !== false && (
                    <Button size="md" onClick={() => setConfirming(true)} disabled={busy !== null}>
                      <ShieldBan aria-hidden="true" /> Confirm &amp; block
                    </Button>
                  )}
                  <Button variant="secondary" size="md" onClick={() => decide("reject")} disabled={busy !== null}>
                    {busy === "reject" ? <Spinner /> : null} Reject
                  </Button>
                </div>
              )
            ) : null
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="md" onClick={() => decide("calling")} disabled={busy !== null || calling}>
                {busy === "calling" ? <Spinner /> : <Phone aria-hidden="true" />} {calling ? "You're calling them" : "I'm calling them"}
              </Button>
              <Button variant="secondary" size="md" onClick={() => decide("mark_safe")} disabled={busy !== null}>
                {busy === "mark_safe" ? <Spinner /> : <ShieldCheck aria-hidden="true" />} Mark safe
              </Button>
            </div>
          )}
          {error && <ErrorCard message={error} />}
        </div>
      )}
    </article>
  );
}

function Sidebar({ data }: { data: DashboardData }) {
  const openCount = data.incidents.filter((i) => i.status === "open").length;
  const item = "flex min-h-11 items-center gap-3 rounded-[14px] px-3 text-[15px] font-bold text-text hover:bg-surface-2";
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-line bg-surface/60 p-5 lg:flex">
      <div className="flex flex-col gap-1">
        <Logo size={28} />
        <p className="mt-2 text-[13px] font-bold text-amber">Safety HQ</p>
        <p className="text-[13px] text-muted">{data.communities.join(" · ")}</p>
      </div>
      <nav aria-label="Safety HQ" className="flex flex-col gap-1">
        <a href="#tonight" className={item}>
          <LayoutDashboard className="size-5 text-muted" aria-hidden="true" /> Tonight
        </a>
        <a href="#incidents" className={item}>
          <BellRing className="size-5 text-muted" aria-hidden="true" /> Incidents
          {openCount > 0 && (
            <span className="ml-auto rounded-full bg-danger px-2 py-0.5 font-mono text-[13px] text-white" aria-label={`${openCount} open`}>
              {openCount}
            </span>
          )}
        </a>
        {data.rules_url ? (
          <a href={data.rules_url} target="_blank" rel="noreferrer" className={item}>
            <BookOpen className="size-5 text-muted" aria-hidden="true" /> Safety rules <ExternalLink className="ml-auto size-4 text-muted" aria-hidden="true" />
          </a>
        ) : (
          <span className={cn(item, "text-muted hover:bg-transparent")}>
            <BookOpen className="size-5" aria-hidden="true" /> Safety rules
            <span className="ml-auto text-[12px] font-semibold">not linked</span>
          </span>
        )}
        <a href="#blocklist" className={item}>
          <ShieldBan className="size-5 text-muted" aria-hidden="true" /> Shared blocklist
          <span className="ml-auto font-mono text-[14px] text-muted">{data.blocklist_count}</span>
        </a>
        <a href="#members" className={item}>
          <Users className="size-5 text-muted" aria-hidden="true" /> Members
          <span className="ml-auto font-mono text-[14px] text-muted">{data.members_count}</span>
        </a>
      </nav>
      <Link href="/" className="mt-auto inline-flex min-h-11 items-center gap-2 text-[14px] font-bold text-muted">
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to Flock
      </Link>
    </aside>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 px-5 pt-safe pb-safe">{children}</main>;
}

export function DashboardScreen() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    async function fetchData() {
      if (inFlight) return; // slow network: don't stack polls
      inFlight = true;
      try {
        const res = await fetch("/api/dashboard", { cache: "no-store", signal: AbortSignal.timeout(10000) });
        const body = (await res.json().catch(() => null)) as (DashboardData & { message?: string }) | { message?: string } | null;
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setLoad({ status: "denied", code: res.status });
          return;
        }
        if (!res.ok || !body || !("stats" in body)) {
          const message = body?.message ?? "Couldn't load Safety HQ.";
          setLoad((cur) => (cur.status === "ready" ? { ...cur, refreshError: message } : { status: "error", message }));
          return;
        }
        setLoad({ status: "ready", data: body, refreshError: null });
      } catch {
        if (cancelled) return;
        const message = "Can't reach Flock right now. Retrying…";
        setLoad((cur) => (cur.status === "ready" ? { ...cur, refreshError: message } : { status: "error", message: "Can't reach Flock right now." }));
      } finally {
        inFlight = false;
      }
    }
    void fetchData();
    const t = setInterval(fetchData, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [nonce]);

  if (load.status === "loading") {
    return (
      <Shell>
        <div className="flex flex-col gap-4 pt-10" role="status" aria-label="Loading Safety HQ">
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-40" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        </div>
      </Shell>
    );
  }

  if (load.status === "denied") {
    return (
      <Shell>
        <div className="pt-10">
          <Logo size={30} />
        </div>
        <EmptyState
          title={load.code === 403 ? "Only society safety leads can open Safety HQ" : "Sign in to open Safety HQ"}
          body={
            load.code === 403
              ? "If you run safety for your society, ask an existing lead to give you the lead role."
              : "Use your university email. Safety HQ is for society safety leads."
          }
          action={
            <Button asChild>
              <Link href={load.code === 403 ? "/" : "/login?next=/dashboard"}>{load.code === 403 ? "Back to Flock" : "Sign in"}</Link>
            </Button>
          }
        />
      </Shell>
    );
  }

  if (load.status === "error") {
    return (
      <Shell>
        <div className="pt-10">
          <Logo size={30} />
        </div>
        <h1 className="text-[28px] font-extrabold tracking-[-0.02em]">Safety HQ</h1>
        <ErrorCard
          message={load.message}
          onRetry={() => {
            setLoad({ status: "loading" });
            refresh();
          }}
        />
      </Shell>
    );
  }

  const { data, refreshError } = load;
  const s = data.stats;
  const faster = s.avg_seconds_to_match ? s.baseline_seconds / s.avg_seconds_to_match : null;
  const openIncidents = data.incidents.filter((i) => i.status === "open");
  const resolvedIncidents = data.incidents.filter((i) => i.status === "resolved");

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      <Sidebar data={data} />
      <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-8 px-5 pt-safe pb-safe lg:px-10 lg:pt-10">
        <header className="flex flex-wrap items-end justify-between gap-4 pt-4 lg:pt-0">
          <div>
            <Link href="/" className="mb-3 inline-flex min-h-11 items-center gap-1 text-[14px] font-bold text-muted lg:hidden">
              <ArrowLeft className="size-4" aria-hidden="true" /> Back to Flock
            </Link>
            <Eyebrow>Society Safety HQ · {data.communities.join(" · ")}</Eyebrow>
            <h1 id="tonight" className="mt-1 scroll-mt-6 text-[32px] leading-tight font-extrabold tracking-[-0.02em] lg:text-[40px]">
              Tonight
            </h1>
          </div>
          <p className="flex items-center gap-2 text-[14px] font-semibold text-muted" aria-live="polite">
            <span className={cn("size-2 rounded-full", refreshError ? "bg-amber" : "bg-safe motion-safe:animate-pulse")} aria-hidden="true" />
            {refreshError ? refreshError : <>Live · updated <span className="font-mono">{hhmmss(data.generated_at)}</span></>}
          </p>
        </header>

        {/* The 10x metric */}
        <section className="grid gap-4 rounded-[24px] border border-amber bg-surface p-6 md:grid-cols-[1.3fr_1fr] md:items-center lg:p-8" aria-label="Time to match">
          <div>
            <p className="flex items-center gap-2 text-[15px] font-bold text-muted">
              <Gauge className="size-5 text-amber" aria-hidden="true" /> Average time to a verified match
            </p>
            <p className="mt-2 flex items-baseline gap-3">
              <span className="font-mono text-[88px] leading-none font-semibold text-amber tabular-nums lg:text-[120px]">
                {s.avg_seconds_to_match ?? "—"}
              </span>
              {s.avg_seconds_to_match != null && <span className="text-[24px] font-bold text-muted">seconds</span>}
            </p>
            {s.avg_seconds_to_match == null && <p className="mt-2 text-[15px] text-muted">No matches yet tonight. The first one shows up here live.</p>}
          </div>
          <div className="flex flex-col gap-2 rounded-[20px] bg-surface-2 p-5">
            <p className="text-[14px] font-bold text-muted">Group chat today (baseline)</p>
            <p className="font-mono text-[44px] leading-none font-semibold">{baselineLabel(s.baseline_seconds)}</p>
            <p className="text-[13px] text-muted">Time to a first reply to &ldquo;anyone heading my way?&rdquo;, with no verification.</p>
            {faster != null && faster >= 1.5 && (
              <p className="mt-1 text-[18px] font-extrabold text-safe">
                <span className="font-mono">{faster >= 10 ? Math.round(faster) : faster.toFixed(1)}x</span> faster with Flock
              </p>
            )}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-label="Tonight in numbers">
          <StatTile label="Sessions" value={s.sessions} Icon={CalendarDays} />
          <StatTile label="Walkers" value={s.walkers} Icon={Footprints} sub={s.solo_walks ? `+ ${s.solo_walks} solo check-${s.solo_walks === 1 ? "in" : "ins"}` : undefined} />
          <StatTile label="Matches" value={s.matches} Icon={Users} />
          <StatTile
            label={"Missed check\u2011ins"}
            value={s.missed_checkins}
            Icon={BellRing}
            danger={s.open_missed_checkins > 0}
            sub={s.open_missed_checkins ? `${s.open_missed_checkins} still open` : s.missed_checkins ? "All resolved" : undefined}
          />
          <StatTile label="Open reports" value={s.open_reports} Icon={Flag} />
        </section>

        <section id="incidents" className="flex scroll-mt-6 flex-col gap-4" aria-labelledby="incidents-h">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="incidents-h" className="text-[24px] font-extrabold tracking-[-0.02em]">
              Incidents
            </h2>
            <p className="text-[14px] text-muted">
              <span className="font-mono font-semibold text-text">{openIncidents.length}</span> open
            </p>
          </div>
          {data.incidents.length === 0 ? (
            <EmptyState title="No incidents tonight" body="Missed check-ins, SOS alerts and reports appear here the moment they happen." />
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {[...openIncidents, ...resolvedIncidents].map((i) => (
                <IncidentCard key={i.id} incident={i} onDecided={refresh} />
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4" aria-labelledby="sessions-h">
          <h2 id="sessions-h" className="text-[24px] font-extrabold tracking-[-0.02em]">
            Sessions
          </h2>
          {data.sessions.length === 0 ? (
            <EmptyState title="No sessions tonight" body="Sessions ending in the last 6 hours or the next 12 show up here." />
          ) : (
            <ul className="overflow-hidden rounded-[20px] border border-line bg-surface">
              {data.sessions.map((ss) => (
                <li key={ss.id} className="flex min-h-[60px] flex-wrap items-center gap-x-6 gap-y-1 border-b border-line px-5 py-3 last:border-b-0">
                  <span className="font-mono text-[15px] font-semibold text-amber">{hhmm(ss.ends_at)}</span>
                  <span className="min-w-0 flex-1 text-[16px] font-bold">{ss.title}</span>
                  <span className="text-[14px] text-muted">
                    <span className="font-mono font-semibold text-text">{ss.walkers}</span> {ss.walkers === 1 ? "walker" : "walkers"} ·{" "}
                    <span className="font-mono font-semibold text-text">{ss.matches}</span> {ss.matches === 1 ? "match" : "matches"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <div id="blocklist" className="flex scroll-mt-6 flex-col gap-2 rounded-[20px] border border-line bg-surface p-5">
            <p className="flex items-center gap-2 text-[14px] font-bold text-muted">
              <ShieldBan className="size-4" aria-hidden="true" /> Shared blocklist
            </p>
            <p className="font-mono text-[40px] leading-none font-semibold">{data.blocklist_count}</p>
            <p className="text-[13px] text-muted">Confirmed bad actors, shared across communities. Stored as hashes only; a human confirmed every one.</p>
          </div>
          <div id="members" className="flex scroll-mt-6 flex-col gap-2 rounded-[20px] border border-line bg-surface p-5">
            <p className="flex items-center gap-2 text-[14px] font-bold text-muted">
              <Users className="size-4" aria-hidden="true" /> Verified members
            </p>
            <p className="font-mono text-[40px] leading-none font-semibold">{data.members_count}</p>
            <p className="text-[13px] text-muted">University email verified. Shown to others by first name only.</p>
          </div>
          <div className="flex flex-col gap-2 rounded-[20px] border border-line bg-surface p-5">
            <p className="flex items-center gap-2 text-[14px] font-bold text-muted">
              <BookOpen className="size-4" aria-hidden="true" /> Safety rules
            </p>
            {data.rules_url ? (
              <a href={data.rules_url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-[16px] font-bold text-amber underline underline-offset-4">
                Open in Notion <ExternalLink className="size-4" aria-hidden="true" />
              </a>
            ) : (
              <p className="text-[15px] text-muted">Safety rules aren&apos;t linked yet.</p>
            )}
            <p className="text-[13px] text-muted">Grok Bot reviews each incident against these rules. A human decides.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
