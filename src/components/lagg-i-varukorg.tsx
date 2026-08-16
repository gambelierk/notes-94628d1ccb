"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useVarukorg } from "@/components/varukorg-context";
import { formatPris } from "@/lib/format";

export type VariantData = {
  id: string;
  size: string;
  color: string;
  stock: number;
};

type Props = {
  produkt: {
    id: string;
    slug: string;
    name: string;
    priceOre: number;
    image: string | null;
  };
  varianter: VariantData[];
};

export function LaggIVarukorg({ produkt, varianter }: Props) {
  const { laggTill } = useVarukorg();

  const storlekar = useMemo(
    () => [...new Set(varianter.map((variant) => variant.size))],
    [varianter]
  );
  const farger = useMemo(
    () => [...new Set(varianter.map((variant) => variant.color))],
    [varianter]
  );

  const [storlek, setStorlek] = useState(storlekar[0] ?? "");
  const [farg, setFarg] = useState(farger[0] ?? "");
  const [antal, setAntal] = useState(1);
  const [tillagd, setTillagd] = useState(false);

  const vald = varianter.find(
    (variant) => variant.size === storlek && variant.color === farg
  );
  const kanKopa = Boolean(vald && vald.stock > 0);

  function tillgangligFarg(fargNamn: string): boolean {
    return varianter.some(
      (variant) => variant.color === fargNamn && variant.size === storlek && variant.stock > 0
    );
  }

  function tillgangligStorlek(storleksNamn: string): boolean {
    return varianter.some(
      (variant) => variant.size === storleksNamn && variant.stock > 0
    );
  }

  function hanteraLaggTill() {
    if (!vald || vald.stock <= 0) return;
    laggTill({
      productId: produkt.id,
      variantId: vald.id,
      slug: produkt.slug,
      namn: produkt.name,
      storlek: vald.size,
      farg: vald.color,
      antal,
      styckprisOre: produkt.priceOre,
      bild: produkt.image,
    });
    setTillagd(true);
  }

  return (
    <div className="space-y-5">
      <p className="text-2xl font-bold text-blue">{formatPris(produkt.priceOre)}</p>

      {storlekar.length > 0 && (
        <div>
          <span className="etikett">Storlek</span>
          <div className="flex flex-wrap gap-2">
            {storlekar.map((varde) => {
              const finns = tillgangligStorlek(varde);
              const aktiv = varde === storlek;
              return (
                <button
                  key={varde}
                  type="button"
                  onClick={() => {
                    setStorlek(varde);
                    setTillagd(false);
                  }}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                    aktiv
                      ? "border-blue bg-blue text-white"
                      : "border-line bg-white text-black hover:bg-surface"
                  } ${finns ? "" : "opacity-45"}`}
                >
                  {varde}
                  {!finns && <span className="ml-1 text-xs">(slut)</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {farger.length > 0 && (
        <div>
          <span className="etikett">Färg</span>
          <div className="flex flex-wrap gap-2">
            {farger.map((varde) => {
              const finns = tillgangligFarg(varde);
              const aktiv = varde === farg;
              return (
                <button
                  key={varde}
                  type="button"
                  onClick={() => {
                    setFarg(varde);
                    setTillagd(false);
                  }}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                    aktiv
                      ? "border-blue bg-blue text-white"
                      : "border-line bg-white text-black hover:bg-surface"
                  } ${finns ? "" : "opacity-45"}`}
                >
                  {varde}
                  {!finns && <span className="ml-1 text-xs">(slut)</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <label className="etikett" htmlFor="antal">
          Antal
        </label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="knapp-liten h-11 w-11 text-lg"
            onClick={() => setAntal((varde) => Math.max(1, varde - 1))}
            aria-label="Minska antal"
          >
            −
          </button>
          <input
            id="antal"
            type="number"
            min={1}
            max={99}
            value={antal}
            onChange={(event) => {
              const varde = Number(event.target.value);
              setAntal(Number.isFinite(varde) ? Math.min(Math.max(1, varde), 99) : 1);
            }}
            className="falt w-20 text-center"
          />
          <button
            type="button"
            className="knapp-liten h-11 w-11 text-lg"
            onClick={() => setAntal((varde) => Math.min(99, varde + 1))}
            aria-label="Öka antal"
          >
            +
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={hanteraLaggTill}
        disabled={!kanKopa}
        className="knapp-primar w-full"
      >
        {kanKopa ? "Lägg i varukorg" : "Slut i lager"}
      </button>

      {vald && vald.stock > 0 && vald.stock <= 3 && (
        <p className="text-sm text-muted">Endast {vald.stock} kvar i den här kombinationen.</p>
      )}

      {tillagd && (
        <div className="rounded-lg border border-blue bg-blue-soft p-4 text-sm">
          <p className="font-semibold">Tillagd i varukorgen.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/varukorg" className="knapp-primar px-4 py-2 text-sm">
              Till varukorgen
            </Link>
            <Link href="/" className="knapp-sekundar px-4 py-2 text-sm">
              Fortsätt handla
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
