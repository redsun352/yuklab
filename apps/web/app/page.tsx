"use client";

import { FormEvent, useEffect, useState } from "react";
import { createOrder, login, register } from "./lib/api";

const services = [
  { title: "Yük Taşımacılığı", description: "Şehir içi, şehirler arası ve parsiyel taşımacılık.", icon: "▣" },
  { title: "Kurye", description: "Motosikletli ve acil teslimat çözümleri.", icon: "↗" },
  { title: "Acil Yardım", description: "Çekici, akü, lastik, yakıt ve yol yardım desteği.", icon: "!" },
];

export default function HomePage() {
  const [pickup, setPickup] = useState("");
  const [delivery, setDelivery] = useState("");
  const [serviceType, setServiceType] = useState("Yük Taşımacılığı");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authenticated, setAuthenticated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setAuthenticated(Boolean(window.localStorage.getItem("yuklab_access_token")));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      let accessToken = window.localStorage.getItem("yuklab_access_token");
      if (!accessToken) {
        if (!email || password.length < 8) throw new Error("E-posta ve en az 8 karakterli şifre gerekli.");
        if (authMode === "register") {
          const firstName = email.split("@")[0].slice(0, 40) || "YükLab";
          await register({ email, password, firstName, lastName: "Müşteri" });
        }
        const result = await login(email, password);
        accessToken = result.accessToken;
        window.localStorage.setItem("yuklab_access_token", accessToken);
        setAuthenticated(true);
      }

      const result = await createOrder(accessToken, { serviceType, pickupAddress: pickup, deliveryAddress: delivery || undefined });
      setMessage(`Talebin oluşturuldu. Sipariş no: ${result.order.id.slice(0, 8)}`);
      setPickup("");
      setDelivery("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Talep oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">YÜKLAB · SMART LOGISTICS NETWORK</p>
          <h1>Yükünü doğru hizmet sağlayıcıyla buluştur.</h1>
          <p className="lead">Türkiye&apos;den dünyaya ölçeklenmek üzere tasarlanan akıllı lojistik ağı. Taşıma, kurye ve acil yardım ihtiyaçlarını tek noktadan yönet.</p>
        </div>

        <form className="request-card" onSubmit={submit}>
          <div className="request-heading">
            <div><span className="mini-label">GERÇEK API AKIŞI</span><h2>Taşıma ihtiyacını oluştur</h2></div>
            <span className="status-dot" aria-label="Sistem hazır" />
          </div>
          <label>Hizmet<select value={serviceType} onChange={(event) => setServiceType(event.target.value)}><option>Yük Taşımacılığı</option><option>Kurye</option><option>Acil Yardım</option></select></label>
          <label>Nereden?<input value={pickup} onChange={(event) => setPickup(event.target.value)} placeholder="Pickup adresi" required /></label>
          <label>Nereye?<input value={delivery} onChange={(event) => setDelivery(event.target.value)} placeholder="Teslimat adresi" /></label>
          {!authenticated && <>
            <label>E-posta<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ornek@mail.com" required /></label>
            <label>Şifre<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="En az 8 karakter" required /></label>
            <button className="auth-switch" type="button" onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}>
              {authMode === "login" ? "Yeni hesap oluştur" : "Mevcut hesabımla giriş yap"}
            </button>
          </>}
          <button type="submit" disabled={busy}>{busy ? "Gönderiliyor…" : "Talep oluştur"} <span>→</span></button>
          {message && <p className={message.includes("oluşturuldu") ? "success" : "error"}>{message}</p>}
        </form>
      </section>

      <section className="services" aria-label="YükLab hizmetleri">
        {services.map((service) => <article className="service-card" key={service.title}><span className="service-icon">{service.icon}</span><h2>{service.title}</h2><p>{service.description}</p></article>)}
      </section>
      <section className="trust-row"><span>● Gerçek zamanlı eşleştirme</span><span>● Canlı konum takibi</span><span>● Güvenli ödeme altyapısı</span></section>
    </main>
  );
}
