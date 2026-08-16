"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Produktbild } from "@/components/produktbild";
import { delaBildnamn, grupperaPaStam, sorteraPaFilnamn } from "@/lib/bildnamn";
import type { Produktsvar } from "@/app/admin/produkter/actions";

export type Formularbild = { url: string; filnamn: string | null };

export type ProduktFormularData = {
  namn: string;
  beskrivning: string;
  prisKronor: string;
  bilder: Formularbild[];
  aktiv: boolean;
  sortering: number;
  storlekar: string[];
  farger: string[];
  lager: Record<string, number>; // "storlek|färg" -> antal
};

/** Max antal bilder per produkt. */
const MAX_ANTAL_BILDER = 8;
/** Max filstorlek per uppladdad bild (sparas som base64 i databasen). */
const MAX_FILSTORLEK = 1_400_000;

type Props = {
  action: (tidigare: Produktsvar, formData: FormData) => Promise<Produktsvar>;
  start: ProduktFormularData;
  knapptext: string;
};

function delaLista(text: string): string[] {
  return [...new Set(text.split(",").map((del) => del.trim()).filter(Boolean))];
}

function Sparaknapp({ text }: { text: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="knapp-primar">
      {pending ? "Sparar …" : text}
    </button>
  );
}

export function Produktformular({ action, start, knapptext }: Props) {
  const [status, formAction] = useActionState<Produktsvar, FormData>(action, undefined);

  // Alla fält är kontrollerade. Annars nollställs formuläret av React så fort
  // ett sparförsök returnerar ett felmeddelande, och allt inskrivet försvinner.
  const [namn, setNamn] = useState(start.namn);
  const [beskrivning, setBeskrivning] = useState(start.beskrivning);
  const [pris, setPris] = useState(start.prisKronor);
  const [sortering, setSortering] = useState(String(start.sortering));
  const [aktiv, setAktiv] = useState(start.aktiv);
  const [lager, setLager] = useState<Record<string, number>>(start.lager);
  const [storlekarText, setStorlekarText] = useState(start.storlekar.join(", "));
  const [fargerText, setFargerText] = useState(start.farger.join(", "));
  const [bilder, setBilder] = useState<Formularbild[]>(start.bilder);
  const [bildUrl, setBildUrl] = useState("");
  const [bildfel, setBildfel] = useState<string | null>(null);
  const [bildinfo, setBildinfo] = useState<string | null>(null);

  const storlekar = useMemo(() => delaLista(storlekarText), [storlekarText]);
  const farger = useMemo(() => delaLista(fargerText), [fargerText]);

  function lasFil(fil: File): Promise<string> {
    return new Promise((klar, avbryt) => {
      const lasare = new FileReader();
      lasare.onload = () => klar(String(lasare.result ?? ""));
      lasare.onerror = () => avbryt(new Error(`Kunde inte läsa ${fil.name}.`));
      lasare.readAsDataURL(fil);
    });
  }

  /**
   * Läser in en eller flera valda bildfiler. Filerna sorteras på filnamnet, så att
   * t.ex. tshirt_svart_001 hamnar före tshirt_svart_002 oavsett valordning.
   */
  async function laggTillFiler(filer: File[]) {
    setBildfel(null);
    setBildinfo(null);

    const forStora = filer.filter((fil) => fil.size > MAX_FILSTORLEK);
    const felTyp = filer.filter((fil) => !fil.type.startsWith("image/"));
    const giltiga = filer.filter(
      (fil) => fil.type.startsWith("image/") && fil.size <= MAX_FILSTORLEK
    );

    const utrymme = MAX_ANTAL_BILDER - bilder.length;
    if (utrymme <= 0) {
      setBildfel(`Max ${MAX_ANTAL_BILDER} bilder per produkt.`);
      return;
    }

    const sorterade = sorteraPaFilnamn(giltiga, (fil) => fil.name).slice(0, utrymme);

    try {
      const nya: Formularbild[] = [];
      for (const fil of sorterade) {
        nya.push({ url: await lasFil(fil), filnamn: fil.name });
      }
      setBilder((tidigare) => [...tidigare, ...nya]);

      const meddelanden: string[] = [];
      if (nya.length > 1) {
        const grupper = grupperaPaStam(nya, (post) => post.filnamn ?? "");
        meddelanden.push(
          `${nya.length} bilder tillagda i ordning efter filnamn (${nya
            .map((post) => post.filnamn)
            .join(", ")}).`
        );
        if (grupper.size > 1) {
          meddelanden.push(
            `Obs: filnamnen tyder på ${grupper.size} olika produkter (${[...grupper.keys()].join(
              ", "
            )}). Alla bilder hamnar på den här produkten – ta bort dem som inte hör hit.`
          );
        }
      }
      if (giltiga.length > sorterade.length) {
        meddelanden.push(
          `Bara ${sorterade.length} av ${giltiga.length} bilder fick plats (max ${MAX_ANTAL_BILDER} per produkt).`
        );
      }
      if (meddelanden.length > 0) setBildinfo(meddelanden.join(" "));
    } catch (error) {
      setBildfel(error instanceof Error ? error.message : "Kunde inte läsa filerna.");
    }

    if (forStora.length > 0 || felTyp.length > 0) {
      const delar: string[] = [];
      if (forStora.length > 0) {
        delar.push(
          `Hoppade över ${forStora.map((fil) => fil.name).join(", ")} – större än 1,4 MB. Använd en mindre bild eller en bild-URL.`
        );
      }
      if (felTyp.length > 0) {
        delar.push(`${felTyp.map((fil) => fil.name).join(", ")} är inte bildfiler.`);
      }
      setBildfel(delar.join(" "));
    }
  }

  function laggTillUrl() {
    const url = bildUrl.trim();
    if (!url) return;
    if (bilder.length >= MAX_ANTAL_BILDER) {
      setBildfel(`Max ${MAX_ANTAL_BILDER} bilder per produkt.`);
      return;
    }
    setBildfel(null);
    setBilder((tidigare) => [
      ...tidigare,
      { url, filnamn: url.split("/").pop() ?? null },
    ]);
    setBildUrl("");
  }

  function flyttaBild(position: number, steg: number) {
    setBilder((tidigare) => {
      const nyPosition = position + steg;
      if (nyPosition < 0 || nyPosition >= tidigare.length) return tidigare;
      const kopia = [...tidigare];
      [kopia[position], kopia[nyPosition]] = [kopia[nyPosition], kopia[position]];
      return kopia;
    });
  }

  function taBortBild(position: number) {
    setBilder((tidigare) => tidigare.filter((_, index) => index !== position));
  }

  /** Sorterar om alla bilder efter filnamnets löpnummer. */
  function sorteraOmPaFilnamn() {
    setBilder((tidigare) => sorteraPaFilnamn(tidigare, (post) => post.filnamn ?? ""));
    setBildinfo("Bilderna sorterades om efter filnamn.");
  }

  const harFilnamn = bilder.some((bild) => bild.filnamn);

  return (
    <form action={formAction} className="space-y-6">
      <section className="kort space-y-4 p-4">
        <div>
          <label className="etikett" htmlFor="namn">
            Namn
          </label>
          <input
            id="namn"
            name="namn"
            required
            value={namn}
            onChange={(event) => setNamn(event.target.value)}
            className="falt"
          />
        </div>

        <div>
          <label className="etikett" htmlFor="beskrivning">
            Beskrivning
          </label>
          <textarea
            id="beskrivning"
            name="beskrivning"
            required
            rows={5}
            value={beskrivning}
            onChange={(event) => setBeskrivning(event.target.value)}
            className="falt"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="etikett" htmlFor="pris">
              Pris (kr)
            </label>
            <input
              id="pris"
              name="pris"
              required
              inputMode="decimal"
              placeholder="249"
              value={pris}
              onChange={(event) => setPris(event.target.value)}
              className="falt"
            />
          </div>
          <div>
            <label className="etikett" htmlFor="sortering">
              Sortering
            </label>
            <input
              id="sortering"
              name="sortering"
              type="number"
              value={sortering}
              onChange={(event) => setSortering(event.target.value)}
              className="falt"
            />
            <p className="mt-1 text-xs text-muted">Lägre tal visas först på startsidan.</p>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 pb-3 text-sm font-semibold">
              <input
                type="checkbox"
                name="aktiv"
                checked={aktiv}
                onChange={(event) => setAktiv(event.target.checked)}
                className="h-5 w-5 accent-[var(--color-blue)]"
              />
              Synlig i butiken
            </label>
          </div>
        </div>
      </section>

      <section className="kort space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Produktbilder</h2>
          <span className="text-sm text-muted">
            {bilder.length} av {MAX_ANTAL_BILDER}
          </span>
        </div>

        <p className="text-sm text-muted">
          Första bilden är huvudbild och visas på startsidan, i varukorgen och i mejlen.
          Väljer du flera filer på en gång sorteras de automatiskt efter siffran i filnamnet,
          t.ex. <code>tshirt_svart_001</code> före <code>tshirt_svart_002</code>.
        </p>

        {bilder.length > 0 && (
          <ul className="space-y-2">
            {bilder.map((bild, position) => {
              const { nummer } = delaBildnamn(bild.filnamn ?? "");
              return (
                <li
                  key={`${position}-${bild.filnamn ?? bild.url.slice(0, 30)}`}
                  className="flex items-center gap-3 rounded-lg border border-line p-2"
                >
                  <Produktbild
                    src={bild.url}
                    alt=""
                    className="h-16 w-16 shrink-0 rounded-md"
                  />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate font-semibold">
                      {bild.filnamn ?? "Bild utan filnamn"}
                    </p>
                    <p className="text-xs text-muted">
                      {position === 0 ? "Huvudbild" : `Bild ${position + 1}`}
                      {nummer !== null && ` · löpnummer ${nummer}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="knapp-liten px-2"
                      onClick={() => flyttaBild(position, -1)}
                      disabled={position === 0}
                      aria-label={`Flytta ${bild.filnamn ?? "bilden"} uppåt`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="knapp-liten px-2"
                      onClick={() => flyttaBild(position, 1)}
                      disabled={position === bilder.length - 1}
                      aria-label={`Flytta ${bild.filnamn ?? "bilden"} nedåt`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="knapp-liten px-2"
                      onClick={() => taBortBild(position)}
                      aria-label={`Ta bort ${bild.filnamn ?? "bilden"}`}
                    >
                      Ta bort
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {bilder.length > 1 && harFilnamn && (
          <button type="button" className="knapp-liten" onClick={sorteraOmPaFilnamn}>
            Sortera om efter filnamn
          </button>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etikett" htmlFor="bildfil">
              Ladda upp bilder (sparas i databasen)
            </label>
            <input
              id="bildfil"
              type="file"
              accept="image/*"
              multiple
              className="block w-full text-sm"
              onChange={(event) => {
                const filer = Array.from(event.target.files ?? []);
                if (filer.length > 0) void laggTillFiler(filer);
                event.target.value = "";
              }}
            />
            <p className="mt-1 text-xs text-muted">
              Max 1,4 MB per bild. Bilderna sparas som text i databasen – inga filer läggs
              på servern.
            </p>
          </div>

          <div>
            <label className="etikett" htmlFor="bildurl">
              …eller lägg till en bild-URL
            </label>
            <div className="flex gap-2">
              <input
                id="bildurl"
                type="url"
                placeholder="https://…"
                value={bildUrl}
                onChange={(event) => setBildUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    laggTillUrl();
                  }
                }}
                className="falt"
              />
              <button type="button" className="knapp-liten shrink-0" onClick={laggTillUrl}>
                Lägg till
              </button>
            </div>
          </div>
        </div>

        {bildinfo && <p className="text-xs text-muted">{bildinfo}</p>}
        {bildfel && <p className="text-xs font-semibold">{bildfel}</p>}

        <input type="hidden" name="bilder" value={JSON.stringify(bilder)} />
      </section>

      <section className="kort space-y-4 p-4">
        <h2 className="text-lg font-semibold">Storlekar, färger och lager</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etikett" htmlFor="storlekar">
              Storlekar (kommaseparerade)
            </label>
            <input
              id="storlekar"
              name="storlekar"
              required
              value={storlekarText}
              onChange={(event) => setStorlekarText(event.target.value)}
              placeholder="S, M, L, XL"
              className="falt"
            />
          </div>
          <div>
            <label className="etikett" htmlFor="farger">
              Färger (kommaseparerade)
            </label>
            <input
              id="farger"
              name="farger"
              required
              value={fargerText}
              onChange={(event) => setFargerText(event.target.value)}
              placeholder="Svart, Vit, Blå"
              className="falt"
            />
          </div>
        </div>

        {storlekar.length > 0 && farger.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b border-line px-2 py-2 text-left">Lagersaldo</th>
                  {farger.map((farg) => (
                    <th key={farg} className="border-b border-line px-2 py-2 text-left">
                      {farg}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {storlekar.map((storlek) => (
                  <tr key={storlek}>
                    <th className="border-b border-line px-2 py-2 text-left font-semibold">
                      {storlek}
                    </th>
                    {farger.map((farg) => (
                      <td key={farg} className="border-b border-line px-2 py-2">
                        <input
                          type="number"
                          min={0}
                          name={`lager:${storlek}|${farg}`}
                          value={lager[`${storlek}|${farg}`] ?? 0}
                          onChange={(event) =>
                            setLager((tidigare) => ({
                              ...tidigare,
                              [`${storlek}|${farg}`]: Math.max(
                                0,
                                Math.floor(Number(event.target.value)) || 0
                              ),
                            }))
                          }
                          className="falt w-20 px-2 py-1.5"
                          aria-label={`Lagersaldo ${storlek} ${farg}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Fyll i minst en storlek och en färg för att kunna ange lagersaldo.
          </p>
        )}
      </section>

      {status?.fel && (
        <p className="rounded-lg border border-black bg-white p-4 text-sm font-semibold">
          {status.fel}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Sparaknapp text={knapptext} />
        <Link href="/admin/produkter" className="knapp-sekundar">
          Avbryt
        </Link>
      </div>
    </form>
  );
}
