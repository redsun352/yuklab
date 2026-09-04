"use client";

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import { useEffect } from "react";

export type TrackingMapPoint = { lat: number; lng: number; label: string };

type LatLngTuple = [number, number];

function FitBounds({ points }: { points: TrackingMapPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 15, { animate: true });
      return;
    }
    const bounds = points.map((point): LatLngTuple => [point.lat, point.lng]);
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 15, animate: true });
  }, [map, points]);
  return null;
}

export default function TrackingMap({ points, route }: { points: TrackingMapPoint[]; route: TrackingMapPoint[] }) {
  const center = points[0] ? [points[0].lat, points[0].lng] as LatLngExpression : [39.0, 35.0] as LatLngExpression;
  const routePositions = route.map((point): LatLngTuple => [point.lat, point.lng]);

  return (
    <div className="tracking-map-leaflet">
      <MapContainer center={center} zoom={13} scrollWheelZoom className="tracking-leaflet-map">
        <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FitBounds points={points} />
        {routePositions.length >= 2 && <Polyline positions={routePositions} pathOptions={{ weight: 5, opacity: 0.85 }} />}
        {points.map((point, index) => (
          <CircleMarker key={`${point.label}-${point.lat}-${point.lng}-${index}`} center={[point.lat, point.lng]} radius={index === 0 ? 10 : 8} pathOptions={{ weight: 3 }}>
            <Popup>{point.label}</Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
