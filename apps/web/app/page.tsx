"use client";

import { FormEvent, useState } from "react";

const services = [
  { title: "Yük Taşımacılığı", description: "Şehir içi, şehirler arası ve parsiyel taşımacılık.", icon: "▣" },
  { title: "Kurye", description: "Motosikletli ve acil teslimat çözümleri.", icon: "↗" },
  { title: "Acil Yardım", description: "Çekici, akü, lastik, yakıt ve yol yardım desteği.", icon: "!" },
];

export default function HomePage() {
  const [pickup, setPickup] = useState("");
  const [delivery, setDelivery] = useState("");
  const [serviceType, setServiceType] = useState("Yük Taşımacılığı");
  const [submitted, setSubmitted] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">YÜKLAB · SMART LOGISTICS NETWORK</p>
          <h1>Yükünü doğru hizmet sağlayıcıyla buluştur.</h1>
          <p className="lead">
            Türkiye&apos;den dünyaya ölçeklenmek üzere tasarlanan akıllı lojistik ağı.
            Taşıma, kurye ve acil yardım ihtiyaçlarını tek noktadan yönet.
          </p>
        </div>

        <form className="request-card" onSubmit={submit}>
          <div className="request-heading">
            <div>
              <span className="mini-label">HIZLI TALEP</span>
              <h2>Taşıma ihtiyacını oluştur</h2>
            </div>
            <span className="status-dot" aria-label="Sistem hazır" />
          </div>

          <label>
            Hizmet
            <select value={serviceType} onChange={(event) => setServiceType(event.target.value)}>
              <option>Yük Taşımacılığı</option>
              <option>Kurye</option>
              <option>Acil Yardım</option>
            </select>
          </label>
          <label>
            Nereden?
            <input value={pickup} onChange={(event) => setPickup(event.target.value)} placeholder="Pickup adresi" required />
          </label>
          <label>
            Nereye?
            <input value={delivery} onChange={(event) => setDelivery(event.target.value)} placeholder="Teslimat adresi" />
          </label>
          <button type="submit">Talep oluştur <span>→</span></button>
          {submitted && <p className="success">Talep taslağın hazır. Giriş yaptıktan sonra yayınlayabilirsin.</p>}
        </form>
      </section>

      <section className="services" aria-label="YükLab hizmetleri">
        {services.map((service) => (
          <article className="service-card" key={service.title}>
            <span className="service-icon">{service.icon}</span>
            <h2>{service.title}</h2>
            <p>{service.description}</p>
          </article>
        ))}
      </section>

      <section className="trust-row">
        <span>● Gerçek zamanlı eşleştirme</span>
        <span>● Canlı konum takibi</span>
        <span>● Güvenli ödeme altyapısı</span>
      </section>
    </main>
  );
}
