"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getOrderTracking, DriverLocation } from "../../lib/api";

function ageText(timestamp: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (seconds < 10) return "Az önce";
  if (seconds < 60) return `${seconds} sn önce`;
  return `${Math.round(seconds / 60)} dk önce`;
}

type TrackingData = {
  location: DriverLocation;
  order?: { status: string; pickupAddress: string; deliveryAddress?: string | null; pickupLat?: string | null; pickupLng?: string | null; deliveryLat?: string | null; deliveryLng?: string | null };
};

function mapUrl(data: TrackingData) {
  const { location, order } = data;
  const points = [[location.lat, location.lng]];
  if (order?.pickupLat && order.pickupLng) points.push([Number(order.pickupLat), Number(order.pickupLng)]);
  if (order?.deliveryLat && order.deliveryLng) points.push([Number(order.deliveryLat), Number(order.deliveryLng)]);
  const valid = points.filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  const lats = valid.map(([lat]) => lat);
  const lngs = valid.map(([, lng]) => lng);
  const padLat = Math.max((Math.max(...lats) - Math.min(...lats)) * 0.35, 0.004);
  const padLng = Math.max((Math.max(...lngs) - Math.min(...lngs)) * 0.35, 0.004);
  const bbox = `${Math.min(...lngs) - padLng},${Math.min(...lats) - padLat},${Math.max(...lngs) + padLng},${Math.max(...lats) + padLat}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${location.lat},${location.lng}`;
}

export default function TrackingPage({ params }: { params: Promise<{ orderId: string }> }) {
  const [token, setToken] = useState("");
  const [orderId, setOrderId] = useState("");
  const [data, setData] = useState<TrackingData | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void params.then(({ orderId: resolvedOrderId }) => { if (!cancelled) setOrderId(resolvedOrderId); });
    return () => { cancelled = true; };
  }, [params]);

  useEffect(() => {
    if (!orderId) return;
    const t = window.localStorage.getItem("yuklab_access_token") ?? "";
    setToken(t);
    if (!t) { setLoading(false); return; }
    let cancelled = false;
    async function load() {
      try {
        const result = await getOrderTracking(t, orderId) as TrackingData;
        if (!cancelled) { setData(result); setMessage(""); }
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

  const map = useMemo(() => data ? mapUrl(data) : "", [data]);
  const location = data?.location;
  const order = data?.order;

  return <main className="dashboard">
    <header className="dashboard-header"><div><p className="eyebrow">YÜKLAB · LIVE TRACKING</p><h1>Sürücü konumu</h1><p className="lead">Siparişin için son GPS konumunu, rota noktalarını ve konum güncelliğini takip et.</p></div><Link className="nav-link" href="/orders">Siparişlerim →</Link></header>
    {!token ? <div className="notice error">Takibi görmek için giriş yapmalısın.</div> : <section className="tracking-panel">
      <div className="tracking-status"><span className="live-dot" /><strong>{location ? "Canlı konum alınıyor" : "Konum bekleniyor"}</strong>{location && <span>{ageText(location.timestamp)}</span>}</div>
      {loading && !location ? <div className="empty">Konum sorgulanıyor…</div> : location ? <>
        <div className="tracking-coordinates"><div><span>Enlem</span><strong>{location.lat.toFixed(6)}</strong></div><div><span>Boylam</span><strong>{location.lng.toFixed(6)}</strong></div><div><span>Doğruluk</span><strong>{location.accuracyM !== undefined ? `±${location.accuracyM.toFixed(0)} m` : "—"}</strong></div><div><span>Hız</span><strong>{location.speedKph !== undefined ? `${location.speedKph.toFixed(0)} km/sa` : "—"}</strong></div></div>
        <div className="tracking-map-frame"><iframe title="YükLab canlı teslimat haritası" src={map} loading="lazy" referrerPolicy="no-referrer" /></div>
        <div className="tracking-route"><div><span className="route-marker pickup">A</span><div><strong>Alış noktası</strong><small>{order?.pickupAddress ?? "Konum bilgisi yok"}</small></div></div><div className="route-line" /><div><span className="route-marker delivery">B</span><div><strong>Teslimat noktası</strong><small>{order?.deliveryAddress ?? "Belirtilmemiş"}</small></div></div></div>
        <a className="tracking-button" href={`https://www.google.com/maps/dir/?api=1&destination=${location.lat},${location.lng}`} target="_blank" rel="noreferrer">Mevcut konumu Google Maps'te aç →</a>
      </> : <div className="empty">{message || "Sürücü henüz konum paylaşmadı."}</div>}
      {message && location && <div className="notice">{message}</div>}
      <p className="tracking-refresh">Otomatik yenileme: 10 saniye · Durum: {order?.status ?? "—"}</p>
    </section>}
  </main>;
}
