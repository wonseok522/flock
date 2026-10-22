import { Suspense } from "react";
import { LoadingScreen } from "@/components/flock";
import { SoloNewScreen } from "./solo-new-screen";

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <SoloNewScreen />
    </Suspense>
  );
}
