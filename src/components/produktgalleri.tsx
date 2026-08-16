"use client";

import { useState } from "react";
import { Produktbild } from "@/components/produktbild";

export type Galleribild = { url: string; filename?: string | null };

type Props = {
  bilder: Galleribild[];
  produktnamn: string;
};

/** Stor produktbild med miniatyrer under. Första bilden är huvudbild. */
export function Produktgalleri({ bilder, produktnamn }: Props) {
  const [aktivt, setAktivt] = useState(0);

  if (bilder.length === 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <Produktbild src={null} alt={produktnamn} className="aspect-square h-full w-full" />
      </div>
    );
  }

  const index = Math.min(aktivt, bilder.length - 1);

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <Produktbild
          src={bilder[index].url}
          alt={
            bilder.length > 1
              ? `${produktnamn} – bild ${index + 1} av ${bilder.length}`
              : produktnamn
          }
          className="aspect-square h-full w-full"
        />
      </div>

      {bilder.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {bilder.map((bild, position) => (
            <li key={`${bild.url.slice(0, 40)}-${position}`}>
              <button
                type="button"
                onClick={() => setAktivt(position)}
                aria-label={`Visa bild ${position + 1} av ${bilder.length}`}
                aria-current={position === index}
                className={`overflow-hidden rounded-lg border-2 transition-colors ${
                  position === index ? "border-blue" : "border-line hover:border-muted"
                }`}
              >
                <Produktbild
                  src={bild.url}
                  alt=""
                  className="h-16 w-16 sm:h-20 sm:w-20"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
