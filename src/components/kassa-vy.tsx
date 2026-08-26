"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { site } from "@/config/site";
import { formatPris } from "@/lib/format";
import { useVarukorg } from "@/components/varukorg-context";
import { skapaBestallning } from "@/app/(butik)/kassa/actions";
import { KVITTO_LAGRINGSNYCKEL } from "@/lib/kvitto";

export function KassaVy() {
  const router = useRouter();
  const { rader, laddad, summaOre, tomVarukorg } = useVarukorg();
  const [fel, setFel] = useState<string | null>(null);
  const [skickar, startaOvergang] = useTransition();

  const [form, setForm] = useState({ namn: "", epost: "", telefon: "", adress: "" });

  function uppdatera(falt: keyof typeof form, varde: string) {
    setForm((tidigare) => ({ ...tidigare, [falt]: varde }));
  }

  function hanteraSkicka(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFel(null);

    startaOvergang(async () => {
      const svar = await skapaBestallning(
        form,
        rader.map((rad) => ({ variantId: rad.variantId, antal: rad.antal }))
      );

      if (!svar.ok) {
        setFel(svar.fel);
        return;
      }

      window.sessionStorage.setItem(KVITTO_LAGRINGSNYCKEL, JSON.stringify(svar.kvitto));
      tomVarukorg();
      router.push("/kassa/bekraftelse");
    });
  }

  if (!laddad) return <p className="text-muted">Laddar …</p>;

  if (rader.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6">
        <p className="text-muted">Din varukorg är tom, så det finns inget att beställa.</p>
        <Link href="/" className="knapp-primar mt-4">
          Till produkterna
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Ordersammanfattning */}
      <section className="kort p-4">
        <h2 className="mb-3 text-lg font-semibold">Din beställning</h2>
        <ul className="divide-y divide-line">
          {rader.map((rad) => (
            <li key={rad.nyckel} className="flex justify-between gap-4 py-3 text-sm">
              <div>
                <p className="font-semibold">{rad.namn}</p>
                <p className="text-muted">
                  Storlek: {rad.storlek || "–"} · Färg: {rad.farg || "–"}
                </p>
                <p className="text-muted">
                  {rad.antal} st × {formatPris(rad.styckprisOre)}
                </p>
              </div>
              <span className="whitespace-nowrap font-bold">
                {formatPris(rad.antal * rad.styckprisOre)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-lg">
          <span className="font-semibold">Att betala</span>
          <span className="font-bold">{formatPris(summaOre)}</span>
        </div>
        <Link href="/varukorg" className="mt-2 inline-block text-sm font-semibold text-blue hover:underline">
          Ändra i varukorgen
        </Link>
      </section>

      <form onSubmit={hanteraSkicka} className="space-y-6">
        {/* Kunduppgifter */}
        <section className="kort p-4">
          <h2 className="mb-3 text-lg font-semibold">Dina uppgifter</h2>
          <div className="space-y-4">
            <div>
              <label className="etikett" htmlFor="namn">
                Namn <span className="text-blue">*</span>
              </label>
              <input
                id="namn"
                name="namn"
                required
                autoComplete="name"
                className="falt"
                value={form.namn}
                onChange={(event) => uppdatera("namn", event.target.value)}
              />
            </div>
            <div>
              <label className="etikett" htmlFor="epost">
                E-post <span className="text-blue">*</span>
              </label>
              <input
                id="epost"
                name="epost"
                type="email"
                required
                autoComplete="email"
                className="falt"
                value={form.epost}
                onChange={(event) => uppdatera("epost", event.target.value)}
              />
              <p className="mt-1 text-sm text-muted">Hit skickar vi orderbekräftelsen.</p>
            </div>
            <div>
              <label className="etikett" htmlFor="telefon">
                Telefon <span className="text-blue">*</span>
              </label>
              <input
                id="telefon"
                name="telefon"
                type="tel"
                required
                autoComplete="tel"
                className="falt"
                value={form.telefon}
                onChange={(event) => uppdatera("telefon", event.target.value)}
              />
            </div>
            <div>
              <label className="etikett" htmlFor="adress">
                Adress <span className="font-normal text-muted">(valfritt)</span>
              </label>
              <input
                id="adress"
                name="adress"
                autoComplete="street-address"
                className="falt"
                value={form.adress}
                onChange={(event) => uppdatera("adress", event.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Swish-betalning */}
        <section className="kort p-4">
          <h2 className="mb-3 text-lg font-semibold">Betala med Swish</h2>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            {/* Byt ut public/swish-qr.svg mot föreningens egen QR-kod. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={site.swishQrSrc}
              alt="Swish QR-kod"
              className="h-44 w-44 rounded-lg border border-line bg-white p-2"
            />
            <div className="text-sm">
              <p className="text-base font-semibold">
                Skanna och betala via Swish, bekräfta sedan nedan
              </p>
              <p className="mt-2 text-muted">
                Swish-nummer: <strong className="text-black">{site.swishNumber}</strong>
                <br />
                Belopp: <strong className="text-black">{formatPris(summaOre)}</strong>
                <br />
                Skriv gärna ditt namn som meddelande.
              </p>
              <p className="mt-2 text-muted">
                När vi har stämt av betalningen markerar vi din order som betald och du kan
                hämta den hos {site.pickup.place}.
              </p>
            </div>
          </div>
        </section>

        {fel && (
          <p className="rounded-lg border border-black bg-surface p-4 text-sm font-semibold">
            {fel}
          </p>
        )}

        <button type="submit" disabled={skickar} className="knapp-primar w-full">
          {skickar ? "Skickar …" : "Jag har betalat"}
        </button>
        <p className="text-center text-sm text-muted">
          Genom att klicka bekräftar du att betalningen är gjord. Vi kontrollerar den manuellt.
        </p>
      </form>
    </div>
  );
}
