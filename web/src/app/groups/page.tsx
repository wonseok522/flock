import { Suspense } from "react";
import { LoadingScreen } from "@/components/flock";
import { GroupsScreen } from "./groups-screen";

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <GroupsScreen />
    </Suspense>
  );
}
