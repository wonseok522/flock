import { Suspense } from "react";
import { LoadingScreen } from "@/components/flock";
import { WalkRequestScreen } from "./walk-request-screen";

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen label="Loading walk options…" />}>
      <WalkRequestScreen />
    </Suspense>
  );
}
