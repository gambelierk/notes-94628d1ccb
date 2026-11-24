# Lens Flare Generator

Webbapp som lägger anamorfiska lens flares / stjärnreflektioner på de vita ytorna i en highlight-video och exporterar resultatet till After Effects. Allt körs lokalt i webbläsaren (Chrome/Edge rekommenderas).

## Starta
Öppna `lens-flare/index.html` i Chrome eller Edge (dubbelklick fungerar), eller kör en lokal server:

    python3 -m http.server 8000   # öppna sedan http://localhost:8000/lens-flare/

## Arbetsflöde
1. Släpp en highlight-video (vita områden mot svart). Bildfrekvensen läses av automatiskt och videon analyseras bildruta för bildruta.
2. Justera reglagen. Ändringar som påverkar placering (`sim`) räknas om direkt; resten uppdateras i realtid.
3. Exportera: **MP4 (H.264)** med flaren på svart (Add/Screen i After Effects) eller **PNG-sekvens med alfa** (.zip).

## Placering
Flares slumpas bland pixlar över tröskeln, viktade efter ljusstyrka. En "värmekarta" gör att områden som nyligen använts (eller har en aktiv flare) undviks. *Variation*, *Minsta avstånd* och *Återhämtningstid* styr detta. Samma seed ger alltid samma resultat.

## Följ highlights
Varje flare spåras med blockmatchning mellan bildrutor, så den följer highlightens rörelse men behåller sin slumpade position inom ytan.

## Presets
Inbyggda presets, egna presets (sparas i webbläsaren) och import/export av JSON.
