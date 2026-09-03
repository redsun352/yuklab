const services = [
  { title: "Yük Taşımacılığı", description: "Şehir içi, şehirler arası ve parsiyel taşımacılık." },
  { title: "Kurye", description: "Motosikletli ve acil teslimat çözümleri." },
  { title: "Acil Yardım", description: "Çekici, akü, lastik, yakıt ve yol yardım desteği." },
];

export default function HomePage() {
  return (
    <main>
      <section style={{ padding: "72px 24px", maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ maxWidth: 760 }}>
          <p style={{ color: "var(--brand)", fontWeight: 700, letterSpacing: "0.08em" }}>YÜKLAB</p>
          <h1 style={{ fontSize: "clamp(42px, 7vw, 76px)", lineHeight: 1.02, margin: "16px 0" }}>
            Yükünü doğru hizmet sağlayıcıyla buluştur.
          </h1>
          <p style={{ fontSize: 20, lineHeight: 1.6, color: "var(--muted)" }}>
            Türkiye'den dünyaya ölçeklenmek üzere tasarlanan akıllı lojistik ağı.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginTop: 48 }}>
          {services.map((service) => (
            <article key={service.title} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, padding: 24 }}>
              <h2 style={{ marginTop: 0 }}>{service.title}</h2>
              <p style={{ color: "var(--muted)", lineHeight: 1.5 }}>{service.description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
