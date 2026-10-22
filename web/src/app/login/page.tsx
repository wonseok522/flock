import { Suspense } from "react";
import { LoadingScreen } from "@/components/flock";
import { LoginScreen } from "./login-screen";

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <LoginScreen />
    </Suspense>
  );
}
