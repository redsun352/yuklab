export const defaultLocale = "tr-TR" as const;

export const supportedLocales = ["tr-TR", "en-US"] as const;

export const messages = {
  "tr-TR": {
    navigation: {
      profile: "Profil",
      settings: "Ayarlar",
    },
    request: {
      create: "Yük Oluştur",
      offer: "Teklif Ver",
    },
    emergency: {
      stranded: "Yolda Kaldım",
    },
  },
  "en-US": {
    navigation: {
      profile: "Profile",
      settings: "Settings",
    },
    request: {
      create: "Create Shipment",
      offer: "Make an Offer",
    },
    emergency: {
      stranded: "I'm Stranded",
    },
  },
} as const;

export type Locale = keyof typeof messages;
