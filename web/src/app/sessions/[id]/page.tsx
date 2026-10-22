import { Suspense } from "react";
import { LoadingScreen } from "@/components/flock";
import { SessionScreen } from "./session-screen";

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <SessionScreen />
    </Suspense>
  );
}
