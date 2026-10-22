"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";

export type MapPoint = { lat: number; lng: number };
export type MapMarker = MapPoint & { kind: "you" | "buddy" | "station" | "session" | "sos"; label?: string };

// Standard OSM tiles (free, no key), darkened in globals.css (.flock-dark-tiles)
// to match the "Night street" theme. CARTO's dark tiles now need an API key.
const OSM = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function icon(kind: MapMarker["kind"]): L.DivIcon {
  const styles: Record<MapMarker["kind"], string> = {
    you: "width:16px;height:16px;border-radius:999px;background:#F3F1EA;box-shadow:0 0 0 6px rgba(247,181,56,.35)",
    buddy: "width:16px;height:16px;border-radius:999px;background:#4FD18B;box-shadow:0 0 0 6px rgba(79,209,139,.3)",
    station: "width:18px;height:18px;border-radius:999px;border:4px solid #F7B538;background:#0E1220",
    session: "width:14px;height:14px;border-radius:4px;background:#F7B538",
    sos: "width:18px;height:18px;border-radius:999px;background:#D92D20;box-shadow:0 0 0 7px rgba(217,45,32,.35)",
  };
  return L.divIcon({ className: "", html: `<div style="${styles[kind]}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
}

type FitPadding = { topLeft: [number, number]; bottomRight: [number, number] };
const DEFAULT_PAD: FitPadding = { topLeft: [36, 36], bottomRight: [36, 36] };

function FitBounds({ points, pad }: { points: MapPoint[]; pad: FitPadding }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join("|");
  useEffect(() => {
    if (points.length === 1) map.setView([points[0].lat, points[0].lng], 15);
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), {
        paddingTopLeft: pad.topLeft,
        paddingBottomRight: pad.bottomRight,
        maxZoom: 16,
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when the points change
  }, [key, map]);
  return null;
}

function Picker({ onPick }: { onPick: (p: MapPoint) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

export default function FlockMap({
  markers,
  route,
  height = 260,
  onPick,
  fit,
  fitPadding = DEFAULT_PAD,
  className,
}: {
  markers: MapMarker[];
  /** Straight line from start to end; `progress` 0–1 draws the walked part solid. */
  route?: { from: MapPoint; to: MapPoint; progress?: number };
  height?: number | string;
  onPick?: (p: MapPoint) => void;
  fit?: MapPoint[];
  /** Extra room (px) when fitting, e.g. for overlays on top of the map. */
  fitPadding?: FitPadding;
  className?: string;
}) {
  const center = markers[0] ?? route?.from ?? { lat: 51.5072, lng: -0.1276 };
  const fitPoints = useMemo(() => fit ?? [...markers, ...(route ? [route.from, route.to] : [])], [fit, markers, route]);
  const split = route
    ? {
        lat: route.from.lat + (route.to.lat - route.from.lat) * (route.progress ?? 0),
        lng: route.from.lng + (route.to.lng - route.from.lng) * (route.progress ?? 0),
      }
    : null;

  return (
    <div className={className} style={{ height }}>
      <MapContainer center={[center.lat, center.lng]} zoom={14} style={{ height: "100%", width: "100%" }} zoomControl={false} attributionControl>
        <TileLayer url={OSM} attribution={OSM_ATTR} className="flock-dark-tiles" maxZoom={19} />
        {route && split && (
          <>
            <Polyline positions={[[route.from.lat, route.from.lng], [split.lat, split.lng]]} pathOptions={{ color: "#F7B538", weight: 4 }} />
            <Polyline positions={[[split.lat, split.lng], [route.to.lat, route.to.lng]]} pathOptions={{ color: "#F7B538", weight: 4, dashArray: "2 9", lineCap: "round" }} />
          </>
        )}
        {markers.map((m, i) => (
          <Marker key={`${m.kind}-${i}`} position={[m.lat, m.lng]} icon={icon(m.kind)} keyboard={false}>
            {m.label && (
              <Tooltip permanent direction="top" offset={[0, -10]} className="flock-tip">
                {m.label}
              </Tooltip>
            )}
          </Marker>
        ))}
        {onPick && <Picker onPick={onPick} />}
        <FitBounds points={fitPoints} pad={fitPadding} />
      </MapContainer>
    </div>
  );
}
