"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Crosshair, MapPin, Plus } from "lucide-react";
import { Screen } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorCard, LoadingScreen, PrivacyNote, Skeleton, Spinner } from "@/components/flock";
import { FlockMap, type MapPoint } from "@/components/map";
import { useMember } from "@/lib/use-member";
import { supabase } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { dayLabel, fromLocalInput, hhmm, toLocalInput } from "@/lib/format";
import type { Community } from "@/lib/types";
import { useRpc } from "../shared";

const HQ: MapPoint = { lat: 51.4951, lng: -0.2282 }; // Expedite London HQ, 7 Lyric Square

const inputClass =
  "h-[52px] w-full rounded-[14px] border border-line-strong bg-surface px-4 text-[16px] text-text placeholder:text-muted/70 focus:border-amber focus:outline-none";
const labelClass = "text-[13px] font-semibold text-muted";

function geoMessage(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED) return "Location is off for this site. Tap the map to place the session instead.";
  if (err.code === err.TIMEOUT) return "Finding your location took too long. Tap the map instead.";
  return "Couldn't find your location. Tap the map instead.";
}

export function NewSessionScreen() {
  const router = useRouter();
  const member = useMember();
  const communities = useRpc<Community[]>("my_communities", null, member.status === "ready");

  const [community, setCommunity] = useState("");
  const [title, setTitle] = useState("");
  const [place, setPlace] = useState("");
  const [endsAt, setEndsAt] = useState(() => toLocalInput(new Date(Date.now() + 2 * 60 * 60 * 1000)));
  const [minEnd] = useState(() => toLocalInput(new Date()));
  const [point, setPoint] = useState<MapPoint>(HQ);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (member.status === "loading") return <LoadingScreen />;

  const list = communities.state.status === "ready" ? communities.state.data : [];
  let endsLabel: string | null = null;
  try {
    if (endsAt) endsLabel = `${dayLabel(fromLocalInput(endsAt))}, ${hhmm(fromLocalInput(endsAt))}`;
  } catch {
    endsLabel = null;
  }
  const selected = community || (list.length === 1 ? list[0].id : "");

  function locateMe() {
    setGeoError(null);
    if (!("geolocation" in navigator)) {
      setGeoError("This browser can't share location. Tap the map instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      (err) => {
        setGeoError(geoMessage(err));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selected) return setError("Pick which community this session is for.");
    let iso: string;
    try {
      iso = fromLocalInput(endsAt);
    } catch {
      return setError("Pick an end time.");
    }
    if (new Date(iso).getTime() <= Date.now()) return setError("The end time must be in the future.");
    setBusy(true);
    try {
      const { data, error } = await supabase().rpc("create_session", {
        p_community: selected,
        p_title: title.trim(),
        p_location_name: place.trim(),
        p_lat: point.lat,
        p_lng: point.lng,
        p_ends_at: iso,
      });
      if (error) throw error;
      router.replace(`/sessions/${data as string}`);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <div className="pt-4">
        <Link href="/sessions" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 px-2 text-[15px] font-bold text-muted active:text-text">
          <ArrowLeft className="size-5" aria-hidden="true" /> Sessions
        </Link>
      </div>
      <header>
        <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.02em]">New session</h1>
        <p className="mt-1 text-[15px] text-muted">Studying late? Others in your group can join, then walk home together.</p>
      </header>

      {member.status === "error" ? (
        <ErrorCard message={member.message} onRetry={member.reload} />
      ) : communities.state.status === "loading" ? (
        <div className="flex flex-col gap-4" role="status" aria-live="polite">
          <span className="sr-only">Loading your communities…</span>
          <Skeleton className="h-[52px]" />
          <Skeleton className="h-[52px]" />
          <Skeleton className="h-56" />
        </div>
      ) : communities.state.status === "error" ? (
        <ErrorCard message={communities.state.message} onRetry={communities.retry} />
      ) : list.length === 0 ? (
        <EmptyState
          title="You're not in a verified group yet"
          body="Sessions belong to a community. Groups unlock from your university email."
          action={
            <Button asChild variant="secondary">
              <Link href="/groups">See your groups</Link>
            </Button>
          }
        />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label htmlFor="community" className={labelClass}>Community</label>
            <select
              id="community"
              required
              value={selected}
              onChange={(e) => setCommunity(e.target.value)}
              className={`${inputClass} appearance-none`}
            >
              {list.length > 1 && <option value="">Choose a community</option>}
              {list.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="title" className={labelClass}>What are you doing?</label>
            <input
              id="title"
              required
              maxLength={80}
              placeholder="Late study: algorithms revision"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="place" className={labelClass}>Where?</label>
            <input
              id="place"
              required
              maxLength={80}
              placeholder="UCL Science Library, 2nd floor"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="ends" className={labelClass}>Ends at (London time)</label>
            <input
              id="ends"
              type="datetime-local"
              required
              min={minEnd}
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className={`${inputClass} font-mono [color-scheme:dark]`}
            />
            {endsLabel && (
              <p className="text-[13px] text-muted">
                Ends <span className="font-mono font-semibold text-amber">{endsLabel}</span> London time
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <span id="map-label" className={labelClass}>Pin the meeting point</span>
              <Button type="button" variant="chip" size="sm" onClick={locateMe} disabled={locating}>
                {locating ? <Spinner className="size-4" /> : <Crosshair className="size-4" aria-hidden="true" />} Use my location
              </Button>
            </div>
            <div aria-labelledby="map-label" className="overflow-hidden rounded-[18px] border border-line">
              <FlockMap height={220} markers={[{ ...point, kind: "session", label: place.trim() || "Meeting point" }]} onPick={setPoint} />
            </div>
            <p className="flex items-center gap-1.5 text-[13px] text-muted">
              <MapPin className="size-4 shrink-0" aria-hidden="true" />
              Tap the map to move the pin. <span className="font-mono">{point.lat.toFixed(4)}, {point.lng.toFixed(4)}</span>
            </p>
            {geoError && <p role="alert" className="text-[14px] font-semibold text-amber">{geoError}</p>}
          </div>

          {error && <ErrorCard message={error} />}

          <Button type="submit" disabled={busy || !title.trim() || !place.trim() || !selected}>
            {busy ? <Spinner /> : <Plus aria-hidden="true" />} Create session
          </Button>
          <PrivacyNote>The pin is where you&apos;re studying, never anyone&apos;s home. Only your verified community can see it.</PrivacyNote>
        </form>
      )}
    </Screen>
  );
}
