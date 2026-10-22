import { Suspense } from "react";
import { SosScreen } from "./sos-screen";

// The fallback already shows 999, so the number is on screen before any JS loads.
function SosFallback() {
  return (
    <main className="flex min-h-dvh flex-1 flex-col gap-6 bg-danger-ground px-5 pt-safe pb-safe">
      <h1 className="pt-10 text-[34px] leading-[1.1] font-extrabold tracking-[-0.03em]">In danger? Call 999 first.</h1>
      <a
        href="tel:999"
        className="inline-flex h-[88px] w-full items-center justify-center rounded-[28px] bg-danger text-[26px] font-extrabold text-white"
      >
        Call 999
      </a>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<SosFallback />}>
      <SosScreen />
    </Suspense>
  );
}
