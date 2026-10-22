import { Suspense } from "react";
import { LoadingScreen } from "@/components/flock";
import { SafetyScreen } from "./safety-screen";

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <SafetyScreen />
    </Suspense>
  );
}
