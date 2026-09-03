"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getOrderTracking, DriverLocation } from "../../lib/api";

function ageText(timestamp: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (seconds < 10) return "Az önce";
  if (seconds < 60) return `${seconds} sn önce`;
  return `${Math.round(seconds / 60)} dk önce`;
}

export default function TrackingPage({ params }: { params: Promise<{ orderId: string }> }) {
  const [token, setToken] = useState("");
  const [orderId, setOrderId] = useState("");
  const [location, setLocation] = useState<DriverLocation | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void params.then(({ orderId: resolvedOrderId }) => {
      if (!cancelled) setOrderId(resolvedOrderId);
    });
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
        const result = await getOrderTracking(t, orderId);
        if (!cancelled) { setLocation(result.location); setMessage(""); }
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

  return <main className="dashboard"><header className="dashboard-header"><div><p className="eyebrow">YÜKLAB · LIVE TRACKING</p><h1>Sürücü konumu</h1><p className="lead">Siparişin için son alınan GPS konumunu ve güncelliğini takip et.</p></div><Link className="nav-link" href="/orders">Siparişlerim →</Link></header>{!token?<div className="notice error">Takibi görmek için giriş yapmalısın.</div>:<section className="tracking-panel"><div className="tracking-status"><span className="live-dot" /> <strong>{location ? "Canlı konum alınıyor" : "Konum bekleniyor"}</strong>{location&&<span>{ageText(location.timestamp)}</span>}</div>{loading&&!location?<div className="empty">Konum sorgulanıyor…</div>:location?<><div className="tracking-coordinates"><div><span>Enlem</span><strong>{location.lat.toFixed(6)}</strong></div><div><span>Boylam</span><strong>{location.lng.toFixed(6)}</strong></div><div><span>Doğruluk</span><strong>{location.accuracyM !== undefined ? `±${location.accuracyM.toFixed(0)} m` : "—"}</strong></div><div><span>Hız</span><strong>{location.speedKph !== undefined ? `${location.speedKph.toFixed(0)} km/sa` : "—"}</strong></div></div><div className="tracking-map"><div className="tracking-pin">📍</div><strong>GPS konumu</strong><p>Sürücünün son bilinen konumu aşağıdaki harita bağlantısından açılabilir.</p><a href={`https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`} target="_blank" rel="noreferrer">Konumu haritada aç →</a></div></>:<div className="empty">{message||"Sürücü henüz konum paylaşmadı."}</div>}{message&&location&&<div className="notice">{message}</div>}<p className="tracking-refresh">Otomatik yenileme: 10 saniye</p></section>}</main>;
}
