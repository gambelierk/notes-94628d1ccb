# Bygga mallar i Rive

En mall är en vanlig `.riv`-fil. Editorn läser den automatiskt. Ett manifest behövs bara för
finjustering.

## 1. Artboard

- Gör artboarden i **videons upplösning** (t.ex. 1920×1080) och placera grafiken där den ska
  synas. Bakgrunden ska vara transparent. Då passar mallen bildrutan exakt.
- Alternativt kan en mindre artboard placeras via `layout` i manifestet (se nedan).
- Bädda in typsnitt och bilder i filen. Annars kan exporten skilja sig mellan datorer.

## 2. Redigerbara fält: View Model och data binding

Skapa en **View Model** för artboarden och bind egenskaper till grafiken. Varje egenskap blir ett
fält i egenskapspanelen:

| Rive-typ | Fält i editorn |
|---|---|
| String | Textfält |
| Color | Färgväljare med projektets palett |
| Image | Bildväljare (PNG/JPEG/WebP). Ett tomt fält behåller mallens standardbild |
| Number | Sifferfält |
| Boolean | Kryssruta |
| Enum | Rullgardinsmeny |

Fältnamnen tas från egenskapernas namn (`titleText` visas som "Title text") och standardvärdena
från View Model-instansen.

## 3. Timing: in / hold / out

Skapa tre **linjära animationer** med namnen:

- `in`: spelas från klippets början
- `hold`: loopar så länge klippet varar
- `out`: slutar exakt när klippet slutar

Då anpassar sig mallen när användaren drar i klippets kanter, ungefär som "Responsive Design –
Time" i MOGRT. Om klippet är kortare än `in` + `out` komprimeras båda proportionellt. Även
namnen `intro`/`outro`/`loop` känns igen.

Saknas animationerna används artboardens första **state machine**. Den spelas upp från början
och är fortfarande exakt bildruta för bildruta, men anpassar sig inte till klippets längd.

## 4. Manifest (valfritt)

Inbyggda mallar listas i `apps/editor/public/templates/index.json`:

```json
{
  "id": "lower-third-01",
  "name": "Lower third – enkel",
  "category": "Lower thirds",
  "file": "lower-third-01.riv",
  "artboard": "Main",
  "defaultDuration": 5,
  "layout": { "anchor": "bottom-left", "widthPercent": 38, "marginPercent": 8 },
  "animations": { "in": "Intro", "hold": "Loop", "out": "Outro" },
  "fields": [
    { "key": "title", "label": "Namn" },
    { "key": "subtitle", "label": "Titel" },
    { "key": "internalFlag", "hidden": true }
  ]
}
```

Bara `file` krävs. `fields` byter namn på, sorterar och döljer fält. Fält som inte listas visas
ändå, sist. `layout.anchor` kan vara `top-left`, `top`, `top-right`, `left`, `center`, `right`,
`bottom-left`, `bottom` eller `bottom-right`.

Användare kan också importera egna `.riv`-filer via **Importera .riv**. De hamnar under
"Mina mallar" och läses helt automatiskt.
