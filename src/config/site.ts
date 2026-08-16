/**
 * Alla texter och bilder som föreningen brukar vilja ändra samlas här.
 * Ändra i den här filen – ingen annan kod behöver röras.
 *
 * Hemligheter (databas, API-nycklar, adminkonto, notismejl) ligger i .env,
 * se .env.example.
 */
export const site = {
  /** Visas i sidhuvud, sidtitel och i mejlen. */
  orgName: "Föreningens butik",

  /** Kort rad under logotypen på startsidan. */
  tagline: "Stötta föreningen – hämta ditt köp hos oss.",

  /**
   * Logotyp. Byt ut filen public/logotyp.svg mot er egen
   * (behåll filnamnet, eller ändra sökvägen här).
   */
  logoSrc: "/logotyp.svg",

  /**
   * Swish-QR-kod som visas i kassan.
   * Byt ut filen public/swish-qr.svg mot er egen QR-bild
   * (t.ex. public/swish-qr.png och ändra sökvägen här).
   */
  swishQrSrc: "/swish-qr.svg",

  /** Visas som text bredvid QR-koden i kassan och i mejlet. */
  swishNumber: "123 456 78 90",

  /** Upphämtningsinformation – visas i kassan, på bekräftelsen och i mejlet. */
  pickup: {
    place: "Föreningslokalen",
    address: "Exempelgatan 1, 123 45 Exempelstad",
    hours: "Vardagar 17–19, lördagar 10–13",
    note: "Ta med din ordernummer-kod när du hämtar. Vi hör av oss om något är oklart.",
  },

  /** Kontaktuppgifter som visas för kunden. */
  contactEmail: "kontakt@dinforening.se",
  contactPhone: "070-123 45 67",
} as const;

/** Adress som får avisering om nya beställningar (sätts i .env). */
export function notificationEmail(): string {
  return process.env.ORDER_NOTIFICATION_EMAIL || site.contactEmail;
}
