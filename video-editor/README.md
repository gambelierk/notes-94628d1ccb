# Klipp – videoredigering med Rive-mallar i webbläsaren

En webbaserad videoredigerare där man klipper MP4-material och lägger på rörlig grafik från
**Rive-mallar** (ett öppet alternativ till MOGRT), med export till MP4. Allt körs lokalt i
webbläsaren. Ingen server och inget konto behövs.

![Editorn](docs/skarmbild.jpg)

## Kundprojekt, kompositioner och delningslänkar

**Admin** (`/admin`) skapar ett *kundprojekt* per kund, laddar upp kundens `.riv`-mallar och skickar
delningslänken (`/p/<nyckel>`) till kunden.

![Admin](docs/admin.jpg)

Per mall väljer du namn, kategori, artboard, placering i bilden, standardlängd och vilka fält kunden
ser och vad de heter. Under **Kundens behörigheter** bestämmer du om kunden får ladda upp egna
Rive-mallar. De hamnar då under "Egna mallar" och markeras som *Kunduppladdad* i admin. Du ser
också kundens kompositioner och hur mycket lagring de använder.

**Kunden** öppnar länken och kommer till sin **projekthanterare**:

![Projekthanteraren](docs/projekt.jpg)

- **Kompositioner:** varje komposition är en egen film med eget format (16:9, 9:16, 1:1, 4:5,
  4K eller "från första filmen"). Kompositioner kan skapas, öppnas, döpas om, dupliceras och tas bort.
- **Autosparning:** varje ändring sparas på servern efter en kort paus ("Sparat 14:32" i toppraden).
  Kunden kan stänga fliken, öppna länken senare, även på en annan dator, och fortsätta där hen slutade.
  Om samma komposition ändras i två fönster upptäcks det (versionsnummer) och kunden får välja version.
- **Projektets media:** filmer som kunden importerar laddas upp till projektet (med förloppsindikator)
  och kan återanvändas i alla kompositioner. Editorn läser dem med HTTP range-requests, så stora filer
  behöver inte laddas ner i sin helhet för att spelas upp eller exporteras.
- **Mallar:** projektets mallar, och kundens egna om admin tillåter det.

Delningslänken kan stängas av eller bytas ut. Då slutar den gamla fungera direkt, även för öppna
kompositioner. Kunden kan inte se andra kunders mallar, media eller kompositioner och kan inte nå admin-API:t.

![Editorn](docs/skarmbild.jpg)

## Gränssnitt

Gränssnittet är helt i gråskala: hierarkin kommer från ljushet, vikt och typsnitt, inte färg.
Typsnitten är **Inter** för text och **JetBrains Mono** för tidskoder, siffror, filnamn, etiketter och
metadata. JetBrains Sans, JetBrains eget sans-typsnitt, bygger på Inter men är inte fritt licensierat.
Båda typsnitten bäddas in i appen och hämtas inte från externa tjänster.

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
| `/admin` | Admin: kundprojekt, mallar, behörigheter och delningslänkar |
| `/p/<nyckel>` | Kundens projekthanterare (kompositioner, mallar, media) |
| `/p/<nyckel>/c/<id>` | Editorn för en komposition (sparas automatiskt) |

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
| `MAX_MEDIA_MB` | `2048` | Största film/bild en kund kan ladda upp |
| `WORKSPACE_QUOTA_MB` | `20480` | Total lagring för media per kundprojekt |
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
  server/   Hono + node:sqlite: kundprojekt, mallar, kompositioner, media (range-requests),
            delningslänkar och admininloggning; filer lagras innehållsadresserat på disk
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

- Kompositioner sparas bara för kunder (via delningslänk). Demo-editorn på `/` sparar ingenting.
- Ingen offline-cache: en återöppnad komposition strömmar filmerna från servern. En lokal cache (OPFS)
  skulle göra scrubbning snabbare på långsamma anslutningar.
- Tar kunden bort en film från projektets media visas klipp som använder den som saknade.
- En enda admin (ett lösenord). Flera administratörer med egna konton kan läggas till senare.
- Delningslänken fungerar som en nyckel: alla som har den kommer åt projektets mallar, kompositioner och
  filmer. Byt länk i admin om den sprids.
- Tar admin bort en mall som kunden har lagt på tidslinjen visas klippet som saknat.
- Rive-mallar med **ljud** stöds inte i exporten.
- Endast MP4 in och ut. Fler format kan läggas till senare i `media`-paketet; mediabunny stöder
  redan WebM, MOV med flera.
- Firefox och Safari är inte testade.
- Ingen proxy-redigering: 4K-material med många spår kan bli tungt i förhandsvisningen.
- Formatet väljs när kompositionen skapas, eller i projektinställningarna (klicka i tomrummet på tidslinjen).
  Video skalas in med svarta kanter, och placering per klipp kommer senare.
