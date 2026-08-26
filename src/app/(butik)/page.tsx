import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { site } from "@/config/site";
import { formatPris } from "@/lib/format";
import { Produktbild } from "@/components/produktbild";

export const dynamic = "force-dynamic";

export default async function Hem() {
  const produkter = await prisma.product.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    include: {
      variants: true,
      // Bara huvudbilden behövs i rutnätet.
      images: { orderBy: { sortOrder: "asc" }, take: 1 },
    },
  });

  return (
    <div>
      <section className="mb-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={site.logoSrc}
          alt=""
          aria-hidden="true"
          className="mx-auto h-auto w-full max-w-sm sm:max-w-md"
        />
        {/* Namnet finns i logotypen – rubriken behålls för skärmläsare och sökmotorer. */}
        <h1 className="sr-only">{site.orgName}</h1>
        <p className="mx-auto mt-4 max-w-xl text-muted">{site.tagline}</p>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
          Betala med Swish i kassan och hämta ditt köp hos {site.pickup.place}.
        </p>
      </section>

      <h2 className="mb-4 text-lg font-semibold">Våra produkter</h2>

      {produkter.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-muted">
          Inga produkter är upplagda ännu. Kom gärna tillbaka snart!
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {produkter.map((produkt) => {
            const slutsald = produkt.variants.every((variant) => variant.stock <= 0);
            return (
              <li key={produkt.id}>
                <Link
                  href={`/produkt/${produkt.slug}`}
                  className="group block overflow-hidden rounded-xl border border-line bg-white transition-shadow hover:shadow-md"
                >
                  <div className="relative aspect-square w-full overflow-hidden bg-surface">
                    <Produktbild
                      src={produkt.images[0]?.url ?? null}
                      alt={produkt.name}
                      className="h-full w-full transition-transform group-hover:scale-[1.03]"
                    />
                    {slutsald && (
                      <span className="absolute left-2 top-2 rounded-md bg-black px-2 py-1 text-xs font-semibold text-white">
                        Slutsåld
                      </span>
                    )}
                  </div>
                  <div className="p-3">
                    <h3 className="text-sm font-semibold leading-snug">{produkt.name}</h3>
                    <p className="mt-1 text-sm font-bold text-blue">
                      {formatPris(produkt.priceOre)}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
