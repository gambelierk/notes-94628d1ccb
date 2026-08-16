# Föreningsbutik

En enkel webbutik på svenska för en ideell förening som säljer fysiska produkter för
**upphämtning på plats** – ingen frakt och ingen kortbetalning online. Kunden betalar med
Swish och bekräftar själv i kassan; föreningen stämmer av betalningen manuellt i
adminpanelen.

**Teknik:** Next.js (App Router) + TypeScript, PostgreSQL via Prisma, Tailwind CSS, e-post
via Resend. Appen kan driftsättas på **Render** eller **Netlify** utan kodändringar.

---

## Innehåll

- [Så fungerar butiken](#så-fungerar-butiken)
- [Kom igång lokalt](#kom-igång-lokalt)
- [Databas: Render Postgres, Neon eller Supabase](#databas-render-postgres-neon-eller-supabase)
- [Miljövariabler](#miljövariabler)
- [E-post (Resend)](#e-post-resend)
- [Seeda adminkontot](#seeda-adminkontot)
- [Byta logotyp, Swish-QR och färger](#byta-logotyp-swish-qr-och-färger)
- [Produktbilder](#produktbilder)
- [Driftsättning: Render vs Netlify](#driftsättning-render-vs-netlify)
- [Projektstruktur](#projektstruktur)

---

## Så fungerar butiken

**Publika sidor**

| Sida | Adress | Innehåll |
| --- | --- | --- |
| Hem | `/` | Logotyp och produktrutnät (bild, namn, pris) |
| Produkt | `/produkt/<slug>` | Stor bild, rubrik, beskrivning, Storlek, Färg, Antal, "Lägg i varukorg" |
| Varukorg | `/varukorg` | Rader med storlek/färg/antal, ändra antal, ta bort, delsumma, "Till kassan" |
| Kassa | `/kassa` | Ordersammanfattning, Namn/E-post/Telefon (obligatoriska) + Adress (valfri), Swish-QR, "Jag har betalat" |
| Bekräftelse | `/kassa/bekraftelse` | Ordernummer, beställda varor och upphämtningsinfo |

**Adminsidor (kräver inloggning)**

| Sida | Adress | Innehåll |
| --- | --- | --- |
| Inloggning | `/logga-in` | E-post och lösenord (ett adminkonto) |
| Beställningar | `/admin` | Alla ordrar med ordernummer, kunduppgifter, artiklar, status, statusknappar, CSV-export |
| Produkter | `/admin/produkter` | Lägg till, redigera och ta bort produkter, pris, storlekar/färger, lagersaldo per variant, bild |

**Orderlogik**

1. Kunden klickar "Jag har betalat" → ordern skapas med status `payment_claimed`
   (Betalning uppgiven) och ett kort ordernummer, t.ex. `K7QF2M`.
2. Kunden får en bekräftelse via e-post och föreningen får en avisering.
3. **Lagersaldot dras först när en administratör sätter status till `paid` (Betald).**
   Obekräftade betalningar låser alltså inte upp lagret. Flyttas ordern tillbaka med
   "Ångra steg" läggs saldot tillbaka automatiskt.
4. Statusflödet är `awaiting_payment` → `payment_claimed` → `paid` → `picked_up` och kan
   **bara** ändras från adminpanelen. Det enda kunden kan göra är att skapa ordern som
   `payment_claimed`.

---

## Kom igång lokalt

Kräver Node.js 20 eller senare (22 rekommenderas) och en Postgres-databas.

```bash
# 1. Installera beroenden
npm install

# 2. Skapa din miljöfil och fyll i värdena
cp .env.example .env

# 3. Skapa tabellerna i databasen
npx prisma migrate dev

# 4. Skapa adminkontot (+ två exempelprodukter första gången)
npm run seed

# 5. Starta utvecklingsservern
npm run dev
```

Butiken ligger på <http://localhost:3000> och adminpanelen på
<http://localhost:3000/admin> (inloggning på `/logga-in`).

Nyttiga kommandon:

| Kommando | Gör |
| --- | --- |
| `npm run dev` | Utvecklingsserver |
| `npm run build` | Produktionsbygge |
| `npm run start` | Startar ett byggt projekt |
| `npm run seed` | Skapar/uppdaterar adminkontot |
| `npm run db:migrate` | Kör migrationer i produktion (`prisma migrate deploy`) |
| `npm run typecheck` | TypeScript-kontroll |

---

## Databas: Render Postgres, Neon eller Supabase

Appen läser alltid anslutningen från miljövariabeln **`DATABASE_URL`** och använder en
vanlig Postgres-anslutning. Samma kod fungerar därför mot alla tre alternativen – du
behöver bara klistra in rätt URL.

**Render Postgres**

1. Render → *New* → *Postgres*, välj region och plan.
2. Kopiera **Internal Database URL** (om appen körs på Render) eller **External Database
   URL** (om du kör lokalt mot den).
3. Klistra in som `DATABASE_URL`.

**Neon**

1. Skapa ett projekt på <https://neon.tech>.
2. Kopiera connection-strängen, t.ex.
   `postgresql://user:losenord@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`.
3. Klistra in som `DATABASE_URL`. Behåll `?sslmode=require`.

**Supabase**

1. Skapa ett projekt på <https://supabase.com>.
2. *Project Settings → Database → Connection string → URI*.
3. Klistra in som `DATABASE_URL` och byt ut `[YOUR-PASSWORD]` mot databaslösenordet.
   Kör du på en serverlös plattform (t.ex. Netlify) – välj **Connection pooling**-strängen
   (port `6543`) så att antalet anslutningar hålls nere.

**Skapa tabellerna** (en gång per databas):

```bash
npx prisma migrate deploy   # produktion
npx prisma migrate dev      # lokalt, skapar även nya migrationer
```

---

## Miljövariabler

Alla variabler finns dokumenterade i [`.env.example`](.env.example). Lokalt ligger de i
`.env`; på Render och Netlify sätter du dem i respektive webbgränssnitt.

| Variabel | Krävs | Beskrivning |
| --- | --- | --- |
| `DATABASE_URL` | Ja | Postgres-anslutning (Render/Neon/Supabase). |
| `SESSION_SECRET` | Ja | Signerar admin-inloggningens cookie. Generera med `openssl rand -base64 32`. |
| `ADMIN_EMAIL` | Ja | Adminkontots e-post – används av `npm run seed`. |
| `ADMIN_PASSWORD` | Ja | Adminkontots lösenord (minst 8 tecken) – används av `npm run seed`. |
| `RESEND_API_KEY` | För riktiga mejl | API-nyckel från Resend. Saknas den loggas mejlen i serverloggen i stället. |
| `EMAIL_FROM` | För riktiga mejl | Avsändaradress, t.ex. `Föreningens butik <butik@dinforening.se>`. Domänen måste vara verifierad i Resend. |
| `ORDER_NOTIFICATION_EMAIL` | För riktiga mejl | Föreningens inkorg som får avisering om varje ny beställning. |

---

## E-post (Resend)

Butiken skickar två mejl när en beställning skapas, båda på svenska:

- **Till kunden:** ordernummer, samtliga beställda produkter (namn, storlek, färg, antal,
  styckpris och totalsumma) samt upphämtningsinformation.
- **Till föreningen:** kunduppgifter och samma orderrader.

Så kopplar du på Resend:

1. Skapa ett konto på <https://resend.com> och verifiera föreningens domän
   (*Domains → Add Domain*, lägg till DNS-posterna hos er domänleverantör).
2. Skapa en API-nyckel under *API Keys*.
3. Sätt miljövariablerna:
   - `RESEND_API_KEY` – nyckeln från steg 2.
   - `EMAIL_FROM` – avsändaren, måste tillhöra den verifierade domänen.
   - `ORDER_NOTIFICATION_EMAIL` – föreningens inkorg för aviseringar.

Utan `RESEND_API_KEY`/`EMAIL_FROM` skickas inga riktiga mejl – hela mejltexten skrivs i
stället ut i serverloggen, vilket är praktiskt vid lokal utveckling.

Vill du använda vanlig SMTP i stället byter du ut funktionen `skicka()` i
[`src/lib/email.ts`](src/lib/email.ts) mot t.ex. Nodemailer. Allt innehåll och alla
adresser hanteras på ett ställe i den filen.

---

## Seeda adminkontot

Det finns ett enda adminkonto. Det skapas – eller får nytt lösenord – med:

```bash
npm run seed
```

Kommandot läser `ADMIN_EMAIL` och `ADMIN_PASSWORD` från miljön, hashar lösenordet med
bcrypt och sparar kontot i databasen. Lösenordet lagras aldrig i klartext.

- **Byta lösenord:** ändra `ADMIN_PASSWORD` och kör `npm run seed` igen.
- **På Render:** öppna *Shell* för tjänsten och kör `npm run seed`.
- **På Netlify:** kör kommandot lokalt med produktionens `DATABASE_URL` i din `.env`.

Första gången databasen är tom skapas även två exempelprodukter, som du kan redigera eller
ta bort i adminpanelen.

---

## Byta logotyp, Swish-QR och färger

**Bilder** (byt ut filerna, behåll filnamnen – eller ändra sökvägen i
[`src/config/site.ts`](src/config/site.ts)):

| Fil | Används till |
| --- | --- |
| `public/logotyp.svg` | Logotyp i sidhuvudet, på startsidan och vid inloggningen |
| `public/swish-qr.svg` | Swish-QR-koden i kassan |
| `src/app/icon.svg` | Ikonen i webbläsarfliken |

Ska ni använda PNG i stället? Lägg filen i `public/` och peka om `logoSrc` respektive
`swishQrSrc` i `src/config/site.ts`.

**Texter** – föreningens namn, upphämtningsadress, öppettider, Swish-nummer och
kontaktuppgifter ändras samlat i `src/config/site.ts`.

**Färger** – paletten ligger som CSS-variabler överst i
[`src/app/globals.css`](src/app/globals.css):

```css
@theme {
  --color-black: #101014; /* PLACEHOLDER */
  --color-white: #ffffff; /* PLACEHOLDER */
  --color-blue: #006eb7;  /* PLACEHOLDER */
}
```

Byt ut de tre hex-koderna mot föreningens exakta färger, så uppdateras hela butiken.
Övriga nyanser (kanter, hjälptext, hover-lägen) räknas fram automatiskt ur dessa tre.

---

## Produktbilder

Ingenting skrivs till filsystemet – det fungerar inte på Render eller Netlify, där
serverns disk nollställs vid varje driftsättning. I stället kan en produktbild anges på
två sätt i adminpanelen:

1. **Bild-URL** – klistra in en länk till bilden (Cloudinary, S3, Supabase Storage,
   föreningens hemsida …). Rekommenderas för stora bilder.
2. **Ladda upp bild** – filen omvandlas till text (base64) och sparas direkt i databasen.
   Enklast när man vill komma igång, max 1,4 MB per bild.

---

## Driftsättning: Render vs Netlify

Samma kod fungerar på båda. Skillnaderna är bara konfiguration.

### Render

Filen [`render.yaml`](render.yaml) finns färdig i projektet (*New → Blueprint*), men du kan
lika gärna skapa tjänsten manuellt:

- **Typ:** Web Service (Node)
- **Build command:** `npm ci && npm run build && npx prisma migrate deploy`
- **Start command:** `npm run start`
- **Miljövariabler:** enligt tabellen ovan. Använd Postgres-tjänstens *Internal Database
  URL* som `DATABASE_URL`.
- Migrationerna körs automatiskt vid varje driftsättning tack vare
  `npx prisma migrate deploy` i build-kommandot.
- Kör `npm run seed` en gång i tjänstens *Shell* för att skapa adminkontot.

### Netlify

Filen [`netlify.toml`](netlify.toml) finns färdig och pekar ut Next.js-pluginet:

- **Build command:** `npm run build`
- **Publish directory:** `.next`
- **Plugin:** `@netlify/plugin-nextjs` (installeras automatiskt av Netlify).
- **Miljövariabler:** samma som ovan, under *Site configuration → Environment variables*.
- **Databas:** Netlify har ingen egen Postgres – använd Neon eller Supabase. Välj deras
  **pooler-anslutning** (Supabase port `6543`, Neon `-pooler`-värden), eftersom
  Netlify-funktioner startar många korta anslutningar.
- **Migrationer:** Netlify kör inte migrationer åt dig. Kör
  `npx prisma migrate deploy` lokalt mot produktionsdatabasen (eller lägg till det i
  build-kommandot: `npx prisma migrate deploy && npm run build`).
- **Adminkonto:** kör `npm run seed` lokalt med produktionens `DATABASE_URL`.

### Sammanfattning

| | Render | Netlify |
| --- | --- | --- |
| Kodändringar | Inga | Inga |
| Databas | Render Postgres (eller Neon/Supabase) | Neon eller Supabase (pooler-URL) |
| Migrationer | I build-kommandot | Körs manuellt eller läggs till i build-kommandot |
| Seed av admin | Via tjänstens Shell | Lokalt mot produktionsdatabasen |
| Konfigurationsfil | `render.yaml` | `netlify.toml` |

---

## Projektstruktur

```
prisma/
  schema.prisma          # Databasmodell (produkter, varianter, ordrar, admin)
  seed.ts                # Skapar adminkonto + exempelprodukter
  migrations/            # Migrationer (körs med prisma migrate deploy)
public/
  logotyp.svg            # PLATSHÅLLARE – byt ut
  swish-qr.svg           # PLATSHÅLLARE – byt ut
src/
  config/site.ts         # Föreningens namn, adress, öppettider, Swish-nummer, bildsökvägar
  app/
    (butik)/             # Publika sidor: hem, produkt, varukorg, kassa, bekräftelse
    admin/               # Adminpanel: beställningar och produkter
    logga-in/            # Inloggning
    api/admin/export/    # CSV-export av beställningar
    globals.css          # Färgpalett (CSS-variabler) och gemensamma komponentklasser
  components/            # Varukorg (klient), formulär, produktkort m.m.
  lib/
    prisma.ts            # Databasklient
    auth.ts              # Inloggning och sessionscookie
    email.ts             # Mejltexter och utskick via Resend
    orders.ts            # Ordernummer, statusflöde och lagerregler
    format.ts            # Pris- och datumformat (sv-SE)
```

CSV-exporten (`Exportera CSV` i adminpanelen) ger en rad per artikel med ordernummer,
datum, status, kunduppgifter, produkt, storlek, färg, antal, styckpris, radsumma och
ordersumma. Filen är UTF-8 med semikolon som avgränsare, så den öppnas direkt i svensk
Excel och i Google Kalkylark.
