"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { CalendarDays, MoonStar, ShieldCheck, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Tonight", icon: MoonStar },
  { href: "/sessions", label: "Sessions", icon: CalendarDays },
  { href: "/groups", label: "Groups", icon: Users },
  { href: "/safety", label: "Safety", icon: ShieldCheck },
] as const;

export function TabBar() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-[1000] border-t border-surface-2 bg-ink/95 backdrop-blur">
      <ul className="mx-auto grid max-w-md grid-cols-4" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn("flex min-h-[60px] flex-col items-center justify-center gap-1 text-[12px] font-bold", active ? "text-amber" : "text-muted")}
              >
                <Icon className="size-6" strokeWidth={2.25} aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Mobile screen: 20px sides, safe-area top, room for the tab bar. */
export function Screen({ children, tabs = true, className }: { children: ReactNode; tabs?: boolean; className?: string }) {
  return (
    <>
      <main className={cn("mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-5 pt-safe", tabs ? "pb-28" : "pb-safe", className)}>
        {children}
      </main>
      {tabs && <TabBar />}
    </>
  );
}

export function ScreenTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="pt-8">
      <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.02em]">{children}</h1>
      {sub && <p className="mt-1 text-[15px] text-muted">{sub}</p>}
    </header>
  );
}
