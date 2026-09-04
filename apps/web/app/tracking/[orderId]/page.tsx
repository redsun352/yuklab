"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getOrderTracking, getRoute, type RoutePoint, type TrackingData } from "../../lib/api";

const TrackingMap = dynamic(() => import("./TrackingMap"), { ssr: false, loading: () => <div className="tracking-map-loading">Harita yükleniyor…</div> });

function ageText(timestamp: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (seconds < 10) return "Az önce";
  if (seconds < 60) return `${seconds} sn önce`;
  return `${Math.round(seconds / 60)} dk önce`;
}

function formatDistance(meters: number) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} dk`;
  return `${Math.floor(minutes / 60)} sa ${minutes % 60} dk`;
}

export default function TrackingPage({ params }: { params: Promise<{ orderId: string }> }) {
  const [token, setToken] = useState("");
  const [orderId, setOrderId] = useState("");
  const [data, setData] = useState<TrackingData | null>(null);
  const [route, setRoute] = useState<RoutePoint[]>([]);
  const [routeDistance, setRouteDistance] = useState<number | null>(null);
  const [routeDuration, setRouteDuration] = useState<number | null>(null);
  const [routeSource, setRouteSource] = useState<"provider" | "fallback" | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void params.then(({ orderId: resolvedOrderId }) => { if (!cancelled) setOrderId(resolvedOrderId); });
    return () => { cancelled = true; };
  }, [params]);

  useEffect(() => {
    if (!orderId) return;
    const accessToken = window.localStorage.getItem("yuklab_access_token") ?? "";
    setToken(accessToken);
    if (!accessToken) { setLoading(false); return; }
    let cancelled = false;

    async function load() {
      try {
        const result = await getOrderTracking(accessToken, orderId);
        if (cancelled) return;
        setData(result);
        setMessage("");

        const destination = result.order?.deliveryLat && result.order.deliveryLng
          ? { lat: Number(result.order.deliveryLat), lng: Number(result.order.deliveryLng) }
          : null;
        if (destination && Number.isFinite(destination.lat) && Number.isFinite(destination.lng)) {
          const routeResult = await getRoute(accessToken, { lat: result.location.lat, lng: result.location.lng }, destination);
          if (!cancelled) {
            setRoute(routeResult.geometry ?? [{ lat: result.location.lat, lng: result.location.lng }, destination]);
            setRouteDistance(routeResult.distanceMeters);
            setRouteDuration(routeResult.durationSeconds);
            setRouteSource(routeResult.source);
          }
        } else if (!cancelled) {
          setRoute([]);
          setRouteDistance(null);
          setRouteDuration(null);
          setRouteSource(null);
        }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Konum alınamadı.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [orderId]);

  const location = data?.location;
  const order = data?.order;
  const pickup = order?.pickupLat && order.pickupLng ? { lat: Number(order.pickupLat), lng: Number(order.pickupLng) } : null;
  const delivery = order?.deliveryLat && order.deliveryLng ? { lat: Number(order.deliveryLat), lng: Number(order.deliveryLng) } : null;
  const mapPoints = location ? [
    { lat: location.lat, lng: location.lng, label: "Sürücü · canlı konum" },
    ...(pickup && Number.isFinite(pickup.lat) && Number.isFinite(pickup.lng) ? [{ ...pickup, label: "A · Alış noktası" }] : []),
    ...(delivery && Number.isFinite(delivery.lat) && Number.isFinite(delivery.lng) ? [{ ...delivery, label: "B · Teslimat noktası" }] : []),
  ] : [];
  const googleDestination = delivery ?? location;

  return <main className="dashboard">
    <header className="dashboard-header"><div><p className="eyebrow">YÜKLAB · LIVE TRACKING</p><h1>Sürücü konumu</h1><p className="lead">Siparişin için canlı GPS, rota, mesafe ve tahmini varış süresini takip et.</p></div><Link className="nav-link" href="/orders">Siparişlerim →</Link></header>
    {!token ? <div className="notice error">Takibi görmek için giriş yapmalısın.</div> : <section className="tracking-panel">
      <div className="tracking-status"><span className="live-dot" /><strong>{location ? "Canlı konum alınıyor" : "Konum bekleniyor"}</strong>{location && <span>{ageText(location.timestamp)}</span>}</div>
      {loading && !location ? <div className="empty">Konum sorgulanıyor…</div> : location ? <>
        <div className="tracking-coordinates"><div><span>Enlem</span><strong>{location.lat.toFixed(6)}</strong></div><div><span>Boylam</span><strong>{location.lng.toFixed(6)}</strong></div><div><span>Doğruluk</span><strong>{location.accuracyM !== undefined ? `±${location.accuracyM.toFixed(0)} m` : "—"}</strong></div><div><span>Hız</span><strong>{location.speedKph !== undefined ? `${location.speedKph.toFixed(0)} km/sa` : "—"}</strong></div></div>
        <div className="tracking-route-stats">
          <div><span>Varış mesafesi</span><strong>{routeDistance !== null ? formatDistance(routeDistance) : "—"}</strong></div>
          <div><span>Tahmini varış</span><strong>{routeDuration !== null ? formatDuration(routeDuration) : "—"}</strong></div>
          <div><span>Rota</span><strong>{routeSource === "provider" ? "Yol ağı" : routeSource === "fallback" ? "Yaklaşık" : "Bekleniyor"}</strong></div>
        </div>
        <TrackingMap points={mapPoints} route={route.map((point) => ({ ...point, label: "" }))} />
        <div className="tracking-route"><div><span className="route-marker pickup">A</span><div><strong>Alış noktası</strong><small>{order?.pickupAddress ?? "Konum bilgisi yok"}</small></div></div><div className="route-line" /><div><span className="route-marker delivery">B</span><div><strong>Teslimat noktası</strong><small>{order?.deliveryAddress ?? "Belirtilmemiş"}</small></div></div></div>
        {googleDestination && <a className="tracking-button" href={`https://www.google.com/maps/dir/?api=1&destination=${googleDestination.lat},${googleDestination.lng}`} target="_blank" rel="noreferrer">Rotayı Google Maps'te aç →</a>}
      </> : <div className="empty">{message || "Sürücü henüz konum paylaşmadı."}</div>}
      {message && location && <div className="notice">{message}</div>}
      <p className="tracking-refresh">Otomatik yenileme: 10 saniye · Durum: {order?.status ?? "—"}</p>
    </section>}
  </main>;
}
