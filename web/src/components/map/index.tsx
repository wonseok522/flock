"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/flock";

export type { MapMarker, MapPoint } from "./flock-map";

// Leaflet touches `window`, so it only loads in the browser.
export const FlockMap = dynamic(() => import("./flock-map"), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-[200px] w-full rounded-none" />,
});
