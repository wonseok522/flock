import type { ReactNode } from "react";
import { BadgeCheck, CircleAlert, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export function Logo({ size = 28, withWordmark = true }: { size?: number; withWordmark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path d="M6 12l10-6 10 6" stroke="#F7B538" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 19l10-6 10 6" stroke="#F7B538" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 26l10-6 10 6" stroke="#F3F1EA" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {withWordmark && <span className="text-[22px] font-extrabold tracking-[-0.02em]">Flock</span>}
    </span>
  );
}

const AVATAR_BG = ["bg-avatar-1", "bg-avatar-2", "bg-avatar-3", "bg-avatar-4"];

function avatarIndex(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % AVATAR_BG.length;
}

export function Avatar({ name, size = 32, ring }: { name: string; size?: 26 | 32 | 56; ring?: string }) {
  const text = size === 56 ? "text-[22px]" : size === 32 ? "text-[14px]" : "text-[12px]";
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex items-center justify-center rounded-full font-extrabold text-ink", AVATAR_BG[avatarIndex(name)], text, ring)}
      style={{ width: size, height: size }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

export function AvatarStack({ names, total, ringClass = "ring-2 ring-surface" }: { names: string[]; total: number; ringClass?: string }) {
  const shown = names.slice(0, 4);
  const extra = total - shown.length;
  return (
    <span className="flex items-center" aria-label={`${total} ${total === 1 ? "person" : "people"}`}>
      {shown.map((n, i) => (
        <span key={`${n}-${i}`} className={i ? "-ml-2" : ""}>
          <Avatar name={n} size={32} ring={ringClass} />
        </span>
      ))}
      {extra > 0 && (
        <span className={cn("-ml-2 inline-flex size-8 items-center justify-center rounded-full bg-surface-2 text-[12px] font-bold text-text", ringClass)}>
          +{extra}
        </span>
      )}
    </span>
  );
}

export function VerifiedBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-safe-tint px-2.5 py-1 text-[13px] font-semibold text-safe">
      <BadgeCheck className="size-4" aria-hidden="true" /> {label}
    </span>
  );
}

export function TimeChip({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-full bg-amber-tint px-2.5 py-1 font-mono text-[13px] font-semibold text-amber">{children}</span>;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("eyebrow", className)}>{children}</p>;
}

export function Card({ children, className, highlight }: { children: ReactNode; className?: string; highlight?: boolean }) {
  return (
    <section className={cn("rounded-[22px] border bg-surface p-5", highlight ? "border-amber" : "border-line", className)}>{children}</section>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-[18px] bg-surface", className)} aria-hidden="true" />;
}

export function LoadingScreen({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col gap-4 px-5 pt-14" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-52" />
      <Skeleton className="h-20" />
      <Skeleton className="h-20" />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin", className)} aria-hidden="true" />;
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-[18px] border border-line-strong bg-surface p-4">
      <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber" aria-hidden="true" />
      <div className="flex-1">
        <p className="text-[15px] font-semibold">{message}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-[14px] font-bold text-amber">
            <RefreshCw className="size-4" aria-hidden="true" /> Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-[22px] border border-dashed border-line-strong p-6 text-center">
      <p className="text-[17px] font-extrabold">{title}</p>
      {body && <p className="mt-1 text-[15px] text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function FallbackLabel({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-full border border-line-strong px-2 py-0.5 text-[12px] font-semibold text-muted">{children}</span>;
}

export function PrivacyNote({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted">{children}</p>;
}
