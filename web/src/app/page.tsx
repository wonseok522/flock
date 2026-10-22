import { Suspense } from "react";
import { LoadingScreen } from "@/components/flock";
import { TonightScreen } from "./tonight-screen";

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <TonightScreen />
    </Suspense>
  );
}
