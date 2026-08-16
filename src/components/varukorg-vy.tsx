"use client";

import Link from "next/link";
import { useVarukorg } from "@/components/varukorg-context";
import { Produktbild } from "@/components/produktbild";
import { formatPris } from "@/lib/format";

export function VarukorgVy() {
  const { rader, laddad, summaOre, andraAntal, taBort } = useVarukorg();

  if (!laddad) {
    return <p className="text-muted">Laddar varukorgen …</p>;
  }

  if (rader.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6">
        <p className="text-muted">Din varukorg är tom.</p>
        <Link href="/" className="knapp-primar mt-4">
          Till produkterna
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ul className="space-y-3">
        {rader.map((rad) => (
          <li key={rad.nyckel} className="kort flex gap-3 p-3">
            <Link href={`/produkt/${rad.slug}`} className="shrink-0">
              <Produktbild
                src={rad.bild}
                alt={rad.namn}
                className="h-20 w-20 rounded-lg sm:h-24 sm:w-24"
              />
            </Link>

            <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
              <div>
                <Link href={`/produkt/${rad.slug}`} className="font-semibold hover:underline">
                  {rad.namn}
                </Link>
                <p className="text-sm text-muted">
                  Storlek: {rad.storlek || "–"} · Färg: {rad.farg || "–"}
                </p>
                <p className="text-sm text-muted">Styckpris: {formatPris(rad.styckprisOre)}</p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="knapp-liten h-9 w-9"
                    onClick={() => andraAntal(rad.nyckel, rad.antal - 1)}
                    aria-label={`Minska antal av ${rad.namn}`}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={rad.antal}
                    onChange={(event) => andraAntal(rad.nyckel, Number(event.target.value))}
                    className="falt w-16 px-2 py-1.5 text-center"
                    aria-label={`Antal av ${rad.namn}`}
                  />
                  <button
                    type="button"
                    className="knapp-liten h-9 w-9"
                    onClick={() => andraAntal(rad.nyckel, rad.antal + 1)}
                    aria-label={`Öka antal av ${rad.namn}`}
                  >
                    +
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <span className="font-bold">
                    {formatPris(rad.antal * rad.styckprisOre)}
                  </span>
                  <button
                    type="button"
                    onClick={() => taBort(rad.nyckel)}
                    className="text-sm font-semibold text-muted underline hover:text-black"
                  >
                    Ta bort
                  </button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="kort p-4">
        <div className="flex items-center justify-between text-lg">
          <span className="font-semibold">Delsumma</span>
          <span className="font-bold">{formatPris(summaOre)}</span>
        </div>
        <p className="mt-1 text-sm text-muted">
          Ingen frakt tillkommer – du hämtar din beställning hos oss.
        </p>
        <Link href="/kassa" className="knapp-primar mt-4 w-full">
          Till kassan
        </Link>
        <Link href="/" className="knapp-sekundar mt-2 w-full">
          Fortsätt handla
        </Link>
      </div>
    </div>
  );
}
