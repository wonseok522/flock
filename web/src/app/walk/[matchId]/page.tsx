import { Suspense } from "react";
import { LoadingScreen } from "@/components/flock";
import { WalkScreen } from "./walk-screen";

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen label="Loading your walk…" />}>
      <WalkScreen />
    </Suspense>
  );
}
