"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getOrderTracking, DriverLocation } from "../../lib/api";

function ageText(timestamp: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (seconds < 10) return "Az önce";
  if (seconds < 60) return `${seconds} sn önce`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} dk önce`;
}

export default function TrackingPage({ params }: { params: { orderId: string } }) {
  const [token, setToken] = useState("");
  const [location, setLocation] = useState<DriverLocation | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function load(t: string) {
    try {
      const result = await getOrderTracking(t, params.orderId);
      setLocation(result.location);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Konum alınamadı.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = window.localStorage.getItem("yuklab_access_token") ?? "";
    setToken(t);
    if (!t) { setLoading(false); return; }
    void load(t);
    const timer = window.setInterval(() => void load(t), 10000);
    return () => window.clearInterval(timer);
  }, [params.orderId]);

  return <main className="dashboard"><header className="dashboard-header"><div><p className="eyebrow">YÜKLAB · LIVE TRACKING</p><h1>Sürücü konumu</h1><p className="lead">Siparişin için son alınan GPS konumunu ve güncelliğini takip et.</p></div><Link className="nav-link" href="/orders">Siparişlerim →</Link></header>{!token?<div className="notice error">Takibi görmek için giriş yapmalısın.</div>:<section className="tracking-panel"><div className="tracking-status"><span className="live-dot" /> <strong>{location ? "Canlı konum alınıyor" : "Konum bekleniyor"}</strong>{location&&<span>{ageText(location.timestamp)}</span>}</div>{loading&&!location?<div className="empty">Konum sorgulanıyor…</div>:location?<><div className="tracking-coordinates"><div><span>Enlem</span><strong>{location.lat.toFixed(6)}</strong></div><div><span>Boylam</span><strong>{location.lng.toFixed(6)}</strong></div><div><span>Doğruluk</span><strong>{location.accuracyM !== undefined ? `±${location.accuracyM.toFixed(0)} m` : "—"}</strong></div><div><span>Hız</span><strong>{location.speedKph !== undefined ? `${location.speedKph.toFixed(0)} km/sa` : "—"}</strong></div></div><div className="tracking-map"><div className="tracking-pin">📍</div><strong>Harita sağlayıcısı hazır</strong><p>GPS noktası alındı. Harita entegrasyonu eklendiğinde bu alan gerçek rota ve sürücü hareketini gösterecek.</p><a href={`https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`} target="_blank" rel="noreferrer">Konumu haritada aç →</a></div></>:<div className="empty">{message||"Sürücü henüz konum paylaşmadı."}</div>}{message&&location&&<div className="notice">{message}</div>}<p className="tracking-refresh">Otomatik yenileme: 10 saniye</p></section>}</main>;
}
