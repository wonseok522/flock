import { Suspense } from "react";
import { LoadingScreen } from "@/components/flock";
import { SoloScreen } from "./solo-screen";

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <SoloScreen />
    </Suspense>
  );
}
