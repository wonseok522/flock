import { Suspense } from "react";
import { LoadingScreen } from "@/components/flock";
import { NewSessionScreen } from "./new-session-screen";

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <NewSessionScreen />
    </Suspense>
  );
}
