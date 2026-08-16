import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatPris } from "@/lib/format";
import { Produktbild } from "@/components/produktbild";
import { TaBortProdukt } from "@/components/ta-bort-produkt";

export const dynamic = "force-dynamic";

export default async function Produktlista() {
  const produkter = await prisma.product.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    include: { variants: { orderBy: [{ size: "asc" }, { color: "asc" }] } },
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Produkter</h1>
        <Link href="/admin/produkter/ny" className="knapp-primar px-4 py-2 text-sm">
          Ny produkt
        </Link>
      </div>

      {produkter.length === 0 ? (
        <p className="kort p-6 text-muted">Inga produkter ännu. Lägg upp din första produkt.</p>
      ) : (
        <ul className="space-y-3">
          {produkter.map((produkt) => {
            const totaltLager = produkt.variants.reduce(
              (summa, variant) => summa + variant.stock,
              0
            );
            return (
              <li key={produkt.id} className="kort flex flex-wrap gap-4 p-4">
                <Produktbild
                  src={produkt.image}
                  alt={produkt.name}
                  className="h-24 w-24 shrink-0 rounded-lg"
                />

                <div className="min-w-52 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{produkt.name}</h2>
                    {!produkt.active && (
                      <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-muted">
                        Dold
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-bold text-blue">{formatPris(produkt.priceOre)}</p>
                  <p className="mt-1 text-sm text-muted">
                    Totalt lager: {totaltLager} st ·{" "}
                    {produkt.variants.length} varianter
                  </p>
                  <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                    {produkt.variants.map((variant) => (
                      <li key={variant.id}>
                        {variant.size} / {variant.color}:{" "}
                        <strong className={variant.stock > 0 ? "text-black" : ""}>
                          {variant.stock}
                        </strong>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex h-fit flex-wrap items-center gap-2">
                  <Link href={`/produkt/${produkt.slug}`} className="knapp-liten">
                    Visa
                  </Link>
                  <Link href={`/admin/produkter/${produkt.id}`} className="knapp-liten">
                    Redigera
                  </Link>
                  <TaBortProdukt produktId={produkt.id} namn={produkt.name} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
