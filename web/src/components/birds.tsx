import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** One gull-style bird, wings up, in a 24×10 box. Shared by the logo, the sky and loaders. */
export const BIRD_PATH =
  "M0 3.4C3.4-0.2 8.4 0.2 10.9 4.5 11.4 3.7 12.6 3.7 13.1 4.5 15.6 0.2 20.6-0.2 24 3.4 20 2.4 16.2 3.8 13.4 7.6L12 10 10.6 7.6C7.8 3.8 4 2.4 0 3.4Z";

type Tone = "amber" | "text" | "muted";
const TONE: Record<Tone, string> = { amber: "text-amber", text: "text-text", muted: "text-muted" };

/** A single bird. `flap` animates the wings (off under prefers-reduced-motion). */
export function Bird({
  width = 24,
  tone = "amber",
  flap = false,
  delay = 0,
  className,
  style,
}: {
  width?: number;
  tone?: Tone;
  flap?: boolean;
  delay?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={width}
      height={(width * 11) / 24}
      viewBox="0 -0.5 24 11"
      aria-hidden="true"
      className={cn(TONE[tone], flap && "bird-flap", className)}
      style={{ ...style, animationDelay: flap ? `${delay}s` : undefined }}
    >
      <path d={BIRD_PATH} fill="currentColor" />
    </svg>
  );
}

/** The Flock mark: three birds flying together, two amber and one off-white. */
export function FlockMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <path d={BIRD_PATH} fill="#F7B538" transform="translate(11 5.5) rotate(-8 12 5) scale(0.8)" />
      <path d={BIRD_PATH} fill="#F7B538" transform="translate(3 14) rotate(-8 12 5) scale(0.6)" />
      <path d={BIRD_PATH} fill="#F3F1EA" transform="translate(15.5 20.5) rotate(-8 12 5) scale(0.6)" />
    </svg>
  );
}

/** Small flapping flock for loading and "looking for a buddy" states. */
export function FlyingFlock({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-block h-10 w-24", className)} aria-hidden="true">
      <Bird width={30} flap className="absolute top-0 right-1" />
      <Bird width={22} flap delay={0.25} className="absolute top-4 left-1" />
      <Bird width={22} flap delay={0.5} tone="text" className="absolute right-6 bottom-0" />
    </span>
  );
}

/** Big V formation for the sign-in hero. Lead bird in front, the flock behind. */
const HERO: { x: number; y: number; w: number; tone: Tone; o: number }[] = [
  { x: 50, y: 12, w: 84, tone: "amber", o: 1 },
  { x: 31, y: 32, w: 58, tone: "amber", o: 0.95 },
  { x: 69, y: 34, w: 58, tone: "text", o: 0.95 },
  { x: 15, y: 52, w: 42, tone: "amber", o: 0.75 },
  { x: 85, y: 55, w: 42, tone: "amber", o: 0.75 },
  { x: 3, y: 72, w: 28, tone: "text", o: 0.55 },
  { x: 97, y: 76, w: 28, tone: "text", o: 0.55 },
];

export function HeroFlock({ className }: { className?: string }) {
  return (
    <div className={cn("bird-glide relative mx-auto h-44 w-full max-w-[300px]", className)} aria-hidden="true">
      {HERO.map((b, i) => (
        <Bird
          key={i}
          width={b.w}
          tone={b.tone}
          flap
          delay={i * 0.18}
          className="absolute -translate-x-1/2"
          style={{ left: `${b.x}%`, top: `${b.y}%`, opacity: b.o }}
        />
      ))}
    </div>
  );
}

/** Birds scattered around every screen, behind the content. Quiet: low opacity, slow drift. */
const SKY: { top: string; left: string; w: number; tone: Tone; o: number; drift: number }[] = [
  { top: "4%", left: "56%", w: 26, tone: "amber", o: 0.5, drift: 22 },
  { top: "8%", left: "70%", w: 18, tone: "amber", o: 0.4, drift: 26 },
  { top: "3%", left: "82%", w: 14, tone: "text", o: 0.35, drift: 30 },
  { top: "12%", left: "90%", w: 11, tone: "text", o: 0.3, drift: 33 },
  { top: "16%", left: "3%", w: 18, tone: "text", o: 0.3, drift: 28 },
  { top: "20%", left: "13%", w: 12, tone: "amber", o: 0.3, drift: 35 },
  { top: "22%", left: "42%", w: 12, tone: "muted", o: 0.3, drift: 34 },
  { top: "30%", left: "89%", w: 22, tone: "amber", o: 0.38, drift: 24 },
  { top: "35%", left: "79%", w: 13, tone: "text", o: 0.28, drift: 29 },
  { top: "41%", left: "2%", w: 20, tone: "amber", o: 0.35, drift: 32 },
  { top: "47%", left: "52%", w: 12, tone: "muted", o: 0.25, drift: 31 },
  { top: "53%", left: "88%", w: 16, tone: "text", o: 0.3, drift: 27 },
  { top: "58%", left: "12%", w: 12, tone: "text", o: 0.25, drift: 36 },
  { top: "64%", left: "5%", w: 24, tone: "amber", o: 0.35, drift: 23 },
  { top: "70%", left: "92%", w: 14, tone: "amber", o: 0.3, drift: 30 },
  { top: "75%", left: "78%", w: 18, tone: "muted", o: 0.35, drift: 29 },
  { top: "83%", left: "26%", w: 15, tone: "amber", o: 0.3, drift: 25 },
  { top: "88%", left: "62%", w: 12, tone: "text", o: 0.25, drift: 33 },
];

/** A small V that crosses the top of the screen every so often. */
const MIGRATING = [
  { x: 0, y: 0, w: 20 },
  { x: -18, y: 9, w: 15 },
  { x: -18, y: -9, w: 15 },
  { x: -34, y: 17, w: 12 },
  { x: -34, y: -17, w: 12 },
];

export function FlockSky() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      {SKY.map((b, i) => (
        <span
          key={i}
          className="bird-drift absolute"
          style={{ top: b.top, left: b.left, opacity: b.o, animationDuration: `${b.drift}s`, animationDelay: `${-i * 3}s` }}
        >
          <Bird width={b.w} tone={b.tone} flap delay={i * 0.37} />
        </span>
      ))}
      <span className="bird-migrate absolute top-[13%] left-0" style={{ opacity: 0.6 }}>
        {MIGRATING.map((b, i) => (
          <Bird
            key={i}
            width={b.w}
            tone={i === 0 ? "amber" : "text"}
            flap
            delay={i * 0.15}
            className="absolute"
            style={{ left: b.x, top: b.y }}
          />
        ))}
      </span>
    </div>
  );
}
