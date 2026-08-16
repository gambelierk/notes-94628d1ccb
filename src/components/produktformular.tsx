"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Produktbild } from "@/components/produktbild";
import type { Produktsvar } from "@/app/admin/produkter/actions";

export type ProduktFormularData = {
  namn: string;
  beskrivning: string;
  prisKronor: string;
  bild: string | null;
  aktiv: boolean;
  sortering: number;
  storlekar: string[];
  farger: string[];
  lager: Record<string, number>; // "storlek|färg" -> antal
};

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
  const [bild, setBild] = useState<string>(start.bild ?? "");
  const [bildfel, setBildfel] = useState<string | null>(null);

  const storlekar = useMemo(() => delaLista(storlekarText), [storlekarText]);
  const farger = useMemo(() => delaLista(fargerText), [fargerText]);

  function lasInBild(fil: File) {
    setBildfel(null);
    if (!fil.type.startsWith("image/")) {
      setBildfel("Filen är inte en bild.");
      return;
    }
    if (fil.size > 1_400_000) {
      setBildfel(
        "Bilden är större än 1,4 MB. Välj en mindre bild eller klistra in en bild-URL i stället."
      );
      return;
    }
    const lasare = new FileReader();
    lasare.onload = () => setBild(String(lasare.result ?? ""));
    lasare.onerror = () => setBildfel("Kunde inte läsa filen.");
    lasare.readAsDataURL(fil);
  }

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
        <h2 className="text-lg font-semibold">Produktbild</h2>
        <div className="flex flex-col gap-4 sm:flex-row">
          <Produktbild
            src={bild || null}
            alt="Förhandsvisning"
            className="h-40 w-40 shrink-0 rounded-lg border border-line"
          />
          <div className="flex-1 space-y-3">
            <div>
              <label className="etikett" htmlFor="bildfil">
                Ladda upp bild (sparas i databasen)
              </label>
              <input
                id="bildfil"
                type="file"
                accept="image/*"
                className="block w-full text-sm"
                onChange={(event) => {
                  const fil = event.target.files?.[0];
                  if (fil) lasInBild(fil);
                }}
              />
              <p className="mt-1 text-xs text-muted">
                Max 1,4 MB. Bilden sparas som text i databasen – inga filer läggs på servern.
              </p>
            </div>

            <div>
              <label className="etikett" htmlFor="bildurl">
                …eller bild-URL
              </label>
              <input
                id="bildurl"
                type="url"
                placeholder="https://…"
                value={bild.startsWith("data:") ? "" : bild}
                onChange={(event) => setBild(event.target.value)}
                className="falt"
              />
              {bild.startsWith("data:") && (
                <p className="mt-1 text-xs text-muted">
                  En uppladdad bild används just nu.{" "}
                  <button
                    type="button"
                    className="font-semibold underline"
                    onClick={() => setBild("")}
                  >
                    Ta bort bilden
                  </button>
                </p>
              )}
              {bildfel && <p className="mt-1 text-xs font-semibold">{bildfel}</p>}
            </div>
          </div>
        </div>
        <input type="hidden" name="bild" value={bild} />
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
