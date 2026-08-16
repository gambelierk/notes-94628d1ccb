"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { site } from "@/config/site";
import { formatPris } from "@/lib/format";
import { KVITTO_LAGRINGSNYCKEL } from "@/lib/kvitto";
import type { OrderKvitto } from "@/app/(butik)/kassa/actions";

export function BekraftelseVy() {
  const [kvitto, setKvitto] = useState<OrderKvitto | null>(null);
  const [laddad, setLaddad] = useState(false);

  useEffect(() => {
    try {
      const rawData = window.sessionStorage.getItem(KVITTO_LAGRINGSNYCKEL);
      if (rawData) setKvitto(JSON.parse(rawData) as OrderKvitto);
    } catch {
      setKvitto(null);
    }
    setLaddad(true);
  }, []);

  if (!laddad) return <p className="text-muted">Laddar …</p>;

  if (!kvitto) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6">
        <h1 className="text-xl font-bold">Ingen beställning att visa</h1>
        <p className="mt-2 text-muted">
          Din orderbekräftelse har skickats till din e-post. Kontakta oss på{" "}
          {site.contactEmail} om du inte har fått den.
        </p>
        <Link href="/" className="knapp-primar mt-4">
          Till startsidan
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-blue bg-blue-soft p-6 text-center">
        <h1 className="text-2xl font-bold">Tack för din beställning!</h1>
        <p className="mt-2 text-muted">
          Vi har tagit emot din beställning och kontrollerar Swish-betalningen.
        </p>
        <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-muted">
          Ditt ordernummer
        </p>
        <p className="text-3xl font-bold tracking-[0.2em] text-blue">{kvitto.referens}</p>
        <p className="mt-2 text-sm text-muted">
          Spara koden – du uppger den när du hämtar din beställning.
        </p>
      </section>

      <section className="kort p-4">
        <h2 className="mb-3 text-lg font-semibold">Din beställning</h2>
        <ul className="divide-y divide-line">
          {kvitto.rader.map((rad, index) => (
            <li key={index} className="flex justify-between gap-4 py-3 text-sm">
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
          <span className="font-semibold">Totalt</span>
          <span className="font-bold">{formatPris(kvitto.totalOre)}</span>
        </div>
      </section>

      <section className="kort p-4">
        <h2 className="mb-2 text-lg font-semibold">Upphämtning</h2>
        <p className="text-muted">
          {site.pickup.place}
          <br />
          {site.pickup.address}
          <br />
          Öppettider: {site.pickup.hours}
        </p>
        <p className="mt-2 text-sm text-muted">{site.pickup.note}</p>
      </section>

      <p className="text-sm text-muted">
        En bekräftelse har skickats till {kvitto.epost}.
      </p>

      <Link href="/" className="knapp-sekundar w-full">
        Tillbaka till butiken
      </Link>
    </div>
  );
}
