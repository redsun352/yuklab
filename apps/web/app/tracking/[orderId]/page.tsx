"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getOrderTracking, getRoute, getTrackingWsToken, trackingWebSocketUrl, type RoutePoint, type TrackingData } from "../../lib/api";

const TrackingMap = dynamic(() => import("./TrackingMap"), { ssr: false, loading: () => <div className="tracking-map-loading">Harita yükleniyor…</div> });

const STALE_LOCATION_MS = 60_000;

function locationAgeMs(timestamp: string) {
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? Math.max(0, Date.now() - time) : Number.POSITIVE_INFINITY;
}
function ageText(timestamp: string) {
  const seconds = Math.floor(locationAgeMs(timestamp) / 1000);
  if (!Number.isFinite(seconds)) return "Geçersiz zaman";
  if (seconds < 10) return "Az önce";
  if (seconds < 60) return `${seconds} sn önce`;
  return `${Math.round(seconds / 60)} dk önce`;
}
function formatDistance(meters: number) { return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`; }
function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 60 ? `${minutes} dk` : `${Math.floor(minutes / 60)} sa ${minutes % 60} dk`;
}
function validPoint(lat: string | number | null | undefined, lng: string | number | null | undefined): RoutePoint | null {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return null;
  const point = { lat: Number(lat), lng: Number(lng) };
  return Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180 ? point : null;
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
  const [ageTick, setAgeTick] = useState(0);
  const [realtime, setRealtime] = useState<"connecting" | "connected" | "polling">("connecting");
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    void params.then(({ orderId: resolvedOrderId }) => { if (!cancelled) setOrderId(resolvedOrderId); });
    return () => { cancelled = true; };
  }, [params]);

  useEffect(() => {
    const timer = window.setInterval(() => setAgeTick((value) => value + 1), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!orderId) return;
    const accessToken = window.localStorage.getItem("yuklab_access_token") ?? "";
    setToken(accessToken);
    if (!accessToken) { setLoading(false); return; }
    let cancelled = false;
    let routeTimer: number | undefined;

    const updateRoute = async (current: TrackingData) => {
      const destination = validPoint(current.order?.deliveryLat, current.order?.deliveryLng);
      const from = validPoint(current.location.lat, current.location.lng);
      if (!destination || !from) {
        setRoute([]); setRouteDistance(null); setRouteDuration(null); setRouteSource(null); return;
      }
      try {
        const result = await getRoute(accessToken, from, destination);
        if (cancelled) return;
        setRoute(result.geometry ?? [from, destination]);
        setRouteDistance(result.distanceMeters);
        setRouteDuration(result.durationSeconds);
        setRouteSource(result.source);
      } catch {
        if (!cancelled) { setRoute([from, destination]); setRouteDistance(null); setRouteDuration(null); setRouteSource("fallback"); }
      }
    };

    async function load() {
      try {
        const result = await getOrderTracking(accessToken, orderId);
        if (cancelled) return;
        setData(result); setMessage(""); setLoading(false);
        await updateRoute(result);
      } catch (error) {
        if (!cancelled) { setMessage(error instanceof Error ? error.message : "Konum alınamadı."); setLoading(false); }
      }
    }

    const applyRealtimeLocation = (next: TrackingData["location"]) => {
      if (!Number.isFinite(next.lat) || !Number.isFinite(next.lng) || Math.abs(next.lat) > 90 || Math.abs(next.lng) > 180) return;
      setData((current) => current ? { ...current, location: next } : { location: next });
      if (!routeTimer) {
        routeTimer = window.setTimeout(() => {
          routeTimer = undefined;
          void getOrderTracking(accessToken, orderId).then(updateRoute).catch(() => undefined);
        }, 30000);
      }
    };

    let reconnectTimer: number | undefined;
    let stopped = false;
    const connect = async () => {
      if (stopped) return;
      try {
        const { token: wsToken } = await getTrackingWsToken(accessToken, orderId);
        if (stopped) return;
        const socket = new WebSocket(trackingWebSocketUrl(orderId), [`yuklab-token.${wsToken}`]);
        socketRef.current = socket;
        socket.onopen = () => { setRealtime("connected"); setMessage(""); };
        socket.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data) as { type?: string; location?: TrackingData["location"] };
            if (payload.type === "driver.location" && payload.location) applyRealtimeLocation(payload.location);
          } catch { /* Ignore malformed realtime messages. */ }
        };
        socket.onerror = () => { setRealtime("polling"); };
        socket.onclose = () => {
          socketRef.current = null;
          if (!stopped) { setRealtime("polling"); reconnectTimer = window.setTimeout(() => void connect(), 5000); }
        };
      } catch {
        setRealtime("polling");
        reconnectTimer = window.setTimeout(() => void connect(), 10000);
      }
    };

    void load();
    void connect();
    const pollTimer = window.setInterval(() => void load(), 15000);
    return () => {
      cancelled = true; stopped = true; window.clearInterval(pollTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (routeTimer) window.clearTimeout(routeTimer);
      socketRef.current?.close(); socketRef.current = null;
    };
  }, [orderId]);

  const location = data?.location;
  const order = data?.order;
  const pickup = validPoint(order?.pickupLat, order?.pickupLng);
  const delivery = validPoint(order?.deliveryLat, order?.deliveryLng);
  const stale = location ? locationAgeMs(location.timestamp) > STALE_LOCATION_MS : false;
  const mapPoints = location ? [
    { lat: location.lat, lng: location.lng, label: stale ? "Sürücü · eski konum" : "Sürücü · canlı konum" },
    ...(pickup ? [{ ...pickup, label: "A · Alış noktası" }] : []),
    ...(delivery ? [{ ...delivery, label: "B · Teslimat noktası" }] : []),
  ] : [];
  const googleDestination = delivery ?? validPoint(location?.lat, location?.lng);
  const realtimeLabel = realtime === "connected" ? "WebSocket canlı" : realtime === "polling" ? "Yedek bağlantı" : "Bağlanıyor…";
  void ageTick;

  return <main className="dashboard">
    <header className="dashboard-header"><div><p className="eyebrow">YÜKLAB · LIVE TRACKING</p><h1>Sürücü konumu</h1><p className="lead">Siparişin için canlı GPS, rota, mesafe ve tahmini varış süresini takip et.</p></div><Link className="nav-link" href="/orders">Siparişlerim →</Link></header>
    {!token ? <div className="notice error">Takibi görmek için giriş yapmalısın.</div> : <section className="tracking-panel">
      <div className={`tracking-status${stale ? " tracking-status-stale" : ""}`}><span className="live-dot" /><strong>{stale ? "Konum güncel değil" : location ? "Canlı konum alınıyor" : "Konum bekleniyor"}</strong><span>{realtimeLabel}</span>{location && <span>{ageText(location.timestamp)}</span>}</div>
      {stale && <div className="notice tracking-stale-notice">Sürücünün son konumu 1 dakikadan eski. Yeni GPS verisi gelene kadar haritadaki konum yaklaşık kabul edilmelidir.</div>}
      {loading && !location ? <div className="empty">Konum sorgulanıyor…</div> : location ? <>
        <div className="tracking-coordinates"><div><span>Enlem</span><strong>{location.lat.toFixed(6)}</strong></div><div><span>Boylam</span><strong>{location.lng.toFixed(6)}</strong></div><div><span>Doğruluk</span><strong>{location.accuracyM !== undefined ? `±${location.accuracyM.toFixed(0)} m` : "—"}</strong></div><div><span>Hız</span><strong>{location.speedKph !== undefined ? `${location.speedKph.toFixed(0)} km/sa` : "—"}</strong></div></div>
        <div className="tracking-route-stats"><div><span>Varış mesafesi</span><strong>{routeDistance !== null ? formatDistance(routeDistance) : "—"}</strong></div><div><span>Tahmini varış</span><strong>{routeDuration !== null ? formatDuration(routeDuration) : "—"}</strong></div><div><span>Rota</span><strong>{routeSource === "provider" ? "Yol ağı" : routeSource === "fallback" ? "Yaklaşık" : "Bekleniyor"}</strong></div></div>
        <TrackingMap points={mapPoints} route={route.map((point) => ({ ...point, label: "" }))} />
        <div className="tracking-route"><div><span className="route-marker pickup">A</span><div><strong>Alış noktası</strong><small>{order?.pickupAddress ?? "Konum bilgisi yok"}</small></div></div><div className="route-line" /><div><span className="route-marker delivery">B</span><div><strong>Teslimat noktası</strong><small>{order?.deliveryAddress ?? "Belirtilmemiş"}</small></div></div></div>
        {googleDestination && <a className="tracking-button" href={`https://www.google.com/maps/dir/?api=1&destination=${googleDestination.lat},${googleDestination.lng}`} target="_blank" rel="noreferrer">Rotayı Google Maps&apos;te aç →</a>}
      </> : <div className="empty">{message || "Sürücü henüz konum paylaşmadı."}</div>}
      {message && location && <div className="notice">{message}</div>}
      <p className="tracking-refresh">WebSocket canlı konum · yedek sorgulama: 15 saniye · Durum: {order?.status ?? "—"}</p>
    </section>}
  </main>;
}
