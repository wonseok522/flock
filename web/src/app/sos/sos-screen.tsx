"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BellRing, CircleCheck, HeartPulse, MapPin, Phone, ShieldAlert, ShieldCheck, Users, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorCard, Eyebrow, Spinner } from "@/components/flock";
import { supabase } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";

type AlertState =
  | { step: "idle" }
  | { step: "locating" }
  | { step: "sending" }
  | { step: "sent"; withLocation: boolean }
  | { step: "error"; message: string };

/** Current position with a hard 3 s cap; null if unavailable or refused. */
function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    const cap = setTimeout(() => resolve(null), 3000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(cap);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        clearTimeout(cap);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 3000, maximumAge: 30_000 },
    );
  });
}

export function SosScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const matchId = params.get("match");
  const tripId = params.get("trip");
  const hasWalk = Boolean(matchId || tripId);
  const backHref = matchId ? `/walk/${matchId}` : tripId ? `/solo/${tripId}` : "/";
  const [alert, setAlert] = useState<AlertState>({ step: "idle" });

  async function alertGroup() {
    setAlert({ step: "locating" });
    const pos = await currentPosition();
    setAlert({ step: "sending" });
    try {
      const { error } = await supabase().rpc("check_in", {
        p_match: matchId,
        p_trip: matchId ? null : tripId,
        p_status: "need_help",
        p_lat: pos?.lat ?? null,
        p_lng: pos?.lng ?? null,
      });
      if (error) throw error;
      setAlert({ step: "sent", withLocation: pos !== null });
    } catch (e) {
      setAlert({ step: "error", message: friendlyError(e) });
    }
  }

  const busy = alert.step === "locating" || alert.step === "sending";
  const recipients = [
    ...(matchId ? [{ icon: UserRound, label: "Your walk buddy" }] : []),
    { icon: Users, label: "Your session group" },
    { icon: ShieldCheck, label: "Your society safety lead" },
  ];

  return (
    <main className="flex min-h-dvh flex-1 flex-col bg-danger-ground">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 pt-safe pb-safe">
        <header className="pt-10">
          <p className="inline-flex items-center gap-2 text-[13px] font-bold tracking-[0.06em] text-danger-soft uppercase">
            <ShieldAlert className="size-4" aria-hidden="true" /> SOS
          </p>
          <h1 className="mt-2 text-[34px] leading-[1.1] font-extrabold tracking-[-0.03em]">In danger? Call 999 first.</h1>
        </header>

        <Button asChild variant="danger" className="h-[88px] rounded-[28px] text-[26px]">
          <a href="tel:999">
            <Phone className="size-7" aria-hidden="true" /> Call 999
          </a>
        </Button>

        {hasWalk ? (
          alert.step === "sent" ? (
            <section className="flex flex-col gap-3 rounded-[22px] border border-danger bg-danger-surface p-5" role="status" aria-live="assertive">
              <p className="flex items-start gap-2 text-[18px] leading-snug font-extrabold">
                <CircleCheck className="mt-0.5 size-6 shrink-0 text-safe" aria-hidden="true" />
                Your group and society safety lead have been alerted
              </p>
              <p className="text-[15px] text-text">
                {alert.withLocation
                  ? "We sent your current location once. Stay somewhere bright and public if you can."
                  : "We couldn't get your location. Tell them where you are when they reach you."}
              </p>
            </section>
          ) : (
            <div className="flex flex-col gap-3">
              <Button variant="redOutline" onClick={alertGroup} disabled={busy} className="h-[60px] text-[17px]">
                {busy ? <Spinner /> : <BellRing aria-hidden="true" />}
                {alert.step === "locating" ? "Getting your location…" : alert.step === "sending" ? "Alerting…" : "Alert my group and society"}
              </Button>
              {alert.step === "error" && (
                <ErrorCard message={`Couldn't send the alert: ${alert.message} Call 999 if you need help now.`} onRetry={alertGroup} />
              )}
            </div>
          )
        ) : (
          <section className="rounded-[22px] border border-danger/50 bg-danger-surface p-5">
            <p className="text-[16px] font-semibold">No walk or check-in timer is running, so there&apos;s no group to alert from here.</p>
            <Button asChild variant="redOutline" size="md" className="mt-4 w-full">
              <Link href="/safety">Open Safety and your university contacts</Link>
            </Button>
          </section>
        )}

        {hasWalk && (
          <section aria-labelledby="who-gets-it">
            <Eyebrow className="text-danger-soft">
              <span id="who-gets-it" className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" aria-hidden="true" /> Who receives your location
              </span>
            </Eyebrow>
            <ul className="mt-3 flex flex-col gap-2">
              {recipients.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-3 rounded-[16px] bg-danger-surface px-4 py-3 text-[16px] font-semibold">
                  <Icon className="size-5 shrink-0 text-danger-soft" aria-hidden="true" /> {label}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[13px] text-text/80">Sent once, only when you tap the alert. Nobody else sees it.</p>
          </section>
        )}

        <section aria-labelledby="non-emergency">
          <Eyebrow className="text-danger-soft">
            <span id="non-emergency">Not an emergency?</span>
          </Eyebrow>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <a href="tel:101" className="flex min-h-16 flex-col justify-center rounded-[16px] border border-danger/50 bg-danger-surface px-4 py-3 active:bg-danger/30">
              <span className="inline-flex items-center gap-2 font-mono text-[22px] font-semibold"><Phone className="size-5" aria-hidden="true" /> 101</span>
              <span className="text-[13px] text-text/80">Police, non-emergency</span>
            </a>
            <a href="tel:111" className="flex min-h-16 flex-col justify-center rounded-[16px] border border-danger/50 bg-danger-surface px-4 py-3 active:bg-danger/30">
              <span className="inline-flex items-center gap-2 font-mono text-[22px] font-semibold"><HeartPulse className="size-5" aria-hidden="true" /> 111</span>
              <span className="text-[13px] text-text/80">NHS, urgent advice</span>
            </a>
          </div>
          {hasWalk && (
            <Link href="/safety" className="mt-3 inline-flex min-h-11 items-center text-[15px] font-semibold text-text underline underline-offset-4">
              University security contacts
            </Link>
          )}
        </section>

        <div className="mt-auto pt-2">
          <Button
            variant="text"
            size="lg"
            className="text-text"
            onClick={() => router.push(backHref)}
          >
            I&apos;m safe, cancel
          </Button>
        </div>
      </div>
    </main>
  );
}
