import { Suspense } from "react";
import { LoadingScreen } from "@/components/flock";
import { DashboardScreen } from "./dashboard-screen";

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen label="Loading Safety HQ…" />}>
      <DashboardScreen />
    </Suspense>
  );
}
