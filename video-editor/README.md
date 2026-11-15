# Klipp – videoredigering med Rive-mallar i webbläsaren

En webbaserad videoredigerare där man klipper MP4-material och lägger på rörlig grafik från
**Rive-mallar** (ett öppet alternativ till MOGRT), med export till MP4. Allt körs lokalt i
webbläsaren. Ingen server och inget konto behövs.

![Editorn](docs/skarmbild.jpg)

## Kundprojekt och delningslänkar

Som admin skapar du ett **kundprojekt** per kund på `/admin`, laddar upp kundens `.riv`-filer och
skickar delningslänken (`/p/<nyckel>`) till kunden. Kunden öppnar länken och får editorn med
**bara det projektets mallar** i panelen. Inget konto behövs.

![Admin](docs/admin.jpg)

Per mall kan du ställa in namn, kategori, artboard (om filen har flera), placering i bilden,
standardlängd och **vilka fält kunden ser och vad de heter** (t.ex. Rive-egenskapen `name` → "Namn").
Tumnaglar och fältlistor tas fram i webbläsaren med samma Rive-kod som editorn använder.

Delningslänken kan stängas av och slås på igen, eller ersättas med en ny (då slutar den gamla
fungera direkt). Kunden kan inte se andra kunders mallar, inte nå admin-API:t och inte importera
egna `.riv`-filer.

## Funktioner i editorn

- **Import** av MP4 (H.264/AAC och det webbläsaren kan avkoda), bilder och egna `.riv`-mallar.
  Filer kan släppas var som helst i fönstret.
- **Tidslinje** med video- och grafikspår: dra in klipp, flytta, trimma, dela (`S`), ta bort
  (`Delete`, med `Shift` stängs luckan), fäst mot kanter och spelhuvud, zoom, och dölj eller tysta spår.
- **Mallbibliotek** med tumnaglar och live-förhandsvisning när muspekaren förs över en mall.
  Mallar dras in på tidslinjen eller läggs vid spelhuvudet med `+`.
- **Egenskapspanel** som byggs automatiskt från mallens View Model (data binding): text, färg
  (med projektets palett), bild, tal, av/på och val.
- **Förhandsvisning** med ljud, där ljudklockan styr uppspelningen.
- **Ångra och gör om** för allt (`⌘/Ctrl+Z`, `⌘/Ctrl+Shift+Z`). Skrivande i ett fält blir ett enda steg.
- **Export** till MP4 (H.264 + AAC 48 kHz stereo) i en Web Worker, med förlopp och möjlighet att
  avbryta. Exporten använder exakt samma renderingsfunktion som förhandsvisningen.

## Kom igång

Kräver Node 22.18 eller senare (kör TypeScript och SQLite inbyggt) och pnpm.

```bash
cd video-editor
pnpm install
pnpm dev          # editor på http://localhost:5173, API på :8787 (lösenord "admin" i utveckling)
```

| Adress | Vad |
|---|---|
| `/` | Demo-editorn med exempelmallar |
| `/admin` | Admin: kundprojekt, uppladdning och delningslänkar |
| `/p/<nyckel>` | Editorn för en kund, med kundprojektets mallar |

Övriga kommandon:

| Kommando | Vad |
|---|---|
| `pnpm build` | Produktionsbygge av gränssnittet till `apps/editor/dist` |
| `pnpm start` | Servern: API och det byggda gränssnittet i en process |
| `pnpm test` | Enhetstester (Vitest): datamodell, mallar och API |
| `pnpm typecheck` | TypeScript, strikt läge |
| `pnpm e2e` | End-to-end i Chromium för editorn och admin→kund (kräver `pnpm build`, Playwright och ffmpeg) |

Webbläsare: Chromium-baserad (Chrome/Edge) med WebCodecs, OffscreenCanvas och WebGL2.

## Drift

```bash
pnpm install --frozen-lockfile && pnpm build
NODE_ENV=production ADMIN_PASSWORD='…minst 12 tecken…' DATA_DIR=/var/lib/klipp pnpm start
```

| Variabel | Standard | Beskrivning |
|---|---|---|
| `ADMIN_PASSWORD` | – (krävs i produktion) | Lösenordet till `/admin` |
| `PORT` | `8787` | |
| `DATA_DIR` | `video-editor/.data` | SQLite-databas och uppladdade filer. Måste ligga på en beständig disk |
| `COOKIE_SECURE` | `true` i produktion | Sätt `false` bara om du kör utan HTTPS lokalt |
| `TRUST_PROXY` | `false` | `true` bakom en proxy, så att inloggningsspärren ser rätt IP |
| `MAX_UPLOAD_MB` | `25` | Största tillåtna .riv-fil |
| `SESSION_DAYS` | `7` | Hur länge en admininloggning gäller |

Kör bakom HTTPS. Säkerhetskopiera `DATA_DIR`.

## Arkitektur

```
packages/
  core/     Datamodell, tidsmatematik, redigeringsoperationer, ångra/gör om, malltiming. Inga DOM-beroenden.
  media/    mediabunny: öppna MP4, bildrutor (VideoFrameReader), ljudmix för export, ljud för förhandsvisning
  rive/     Rive-runtime, inläsning och inspektion av mallar, TemplateRenderer
  render/   WebGL2-kompositor och renderFrame(projekt, bildruta), gemensam för förhandsvisning och export
  export/   Export-worker (rendera → H.264, mixa → AAC, muxa → MP4) och klient-API
apps/
  editor/   React + Zustand (bibliotek, viewer, egenskapspanel, tidslinje, export) och admin (/admin)
  server/   Hono + node:sqlite: kundprojekt, mallar, delningslänkar, admininloggning, filer på disk
```

Principer:

1. **En renderingsväg.** `renderFrame(project, frame)` ritar bildrutor både i förhandsvisningen och
   i exporten, så exporten ser ut som det man såg.
2. **Projektet är data.** Versionerad JSON utan referenser till webbläsarobjekt. Alla operationer
   är rena funktioner (`Project → Project`), vilket ger billiga ögonblicksbilder för ångra/gör om.
3. **Heltalstid.** Tidslinjen räknar i bildrutor och källmaterialet i mikrosekunder, så att
   ingen drift uppstår.
4. **Tungt arbete utanför UI-tråden.** Exporten körs i en Web Worker med OffscreenCanvas.
5. **Förberett för keyframes.** Alla värden är `Param<T>` och läses via `evaluateParam()`.
   Keyframes blir en ny variant av `Param` utan ändringar i renderare eller export. Övergångar blir
   egna objekt mellan klipp, och kompositorn kan redan blanda lager med opacitet.

## Mallar

Se [docs/mallar.md](docs/mallar.md) för hur en mall byggs i Rive (View Model, in/hold/out,
manifest). Demomallarna i `apps/editor/public/templates` är testfiler från Rives öppna runtime
(MIT-licens) och ska ersättas med egna.

## Kända begränsningar och nästa steg

- **Kundens redigeringar sparas inte än:** tidslinjen och videofilerna försvinner vid omladdning.
  Nästa steg är OPFS för mediefiler och IndexedDB för projekt (fas 4).
- En enda admin (ett lösenord). Flera administratörer med egna konton kan läggas till senare.
- Delningslänken fungerar som en nyckel: alla som har den kommer åt mallarna. Byt länk om den sprids.
- Tar admin bort en mall som kunden har lagt på tidslinjen visas klippet som saknat.
- Rive-mallar med **ljud** stöds inte i exporten.
- Endast MP4 in och ut. Fler format kan läggas till senare i `media`-paketet; mediabunny stöder
  redan WebM, MOV med flera.
- Firefox och Safari är inte testade.
- Ingen proxy-redigering: 4K-material med många spår kan bli tungt i förhandsvisningen.
- Fyrkantigt och stående format väljs i projektinställningarna (klicka i tomrummet på tidslinjen).
  Video skalas in med svarta kanter, och placering per klipp kommer senare.
