"use client";

import Link from "next/link";
import { site } from "@/config/site";
import { useVarukorg } from "@/components/varukorg-context";

export function Sidhuvud() {
  const { antalArtiklar, laddad } = useVarukorg();

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex min-w-0 items-center" aria-label="Till startsidan">
          {/* Logotypen innehåller föreningens namn, därför står namnet inte som text bredvid.
              Byt ut public/logotyp.svg mot en annan logotyp vid behov. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={site.logoSrc}
            alt={site.orgName}
            className="h-9 w-auto max-w-[62vw] object-contain sm:h-11 sm:max-w-none"
          />
        </Link>

        <Link
          href="/varukorg"
          className="relative rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:bg-surface"
        >
          Varukorg
          {laddad && antalArtiklar > 0 && (
            <span className="ml-2 inline-flex min-w-6 items-center justify-center rounded-full bg-blue px-2 py-0.5 text-xs font-bold text-white">
              {antalArtiklar}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
