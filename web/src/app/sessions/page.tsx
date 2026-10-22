import { Suspense } from "react";
import { LoadingScreen } from "@/components/flock";
import { SessionsScreen } from "./sessions-screen";

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <SessionsScreen />
    </Suspense>
  );
}
