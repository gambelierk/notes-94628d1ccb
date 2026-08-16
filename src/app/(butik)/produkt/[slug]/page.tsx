import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { site } from "@/config/site";
import { Produktbild } from "@/components/produktbild";
import { LaggIVarukorg } from "@/components/lagg-i-varukorg";

export const dynamic = "force-dynamic";

export default async function Produktsida({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const produkt = await prisma.product.findFirst({
    where: { slug, active: true },
    include: { variants: { orderBy: [{ size: "asc" }, { color: "asc" }] } },
  });

  if (!produkt) notFound();

  return (
    <div>
      <Link href="/" className="text-sm font-semibold text-blue hover:underline">
        ← Tillbaka till produkterna
      </Link>

      <div className="mt-4 grid gap-8 md:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <Produktbild
            src={produkt.image}
            alt={produkt.name}
            className="aspect-square h-full w-full"
          />
        </div>

        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">{produkt.name}</h1>
          <p className="mt-3 whitespace-pre-line text-muted">{produkt.description}</p>

          <div className="mt-6">
            <LaggIVarukorg
              produkt={{
                id: produkt.id,
                slug: produkt.slug,
                name: produkt.name,
                priceOre: produkt.priceOre,
                image: produkt.image,
              }}
              varianter={produkt.variants.map((variant) => ({
                id: variant.id,
                size: variant.size,
                color: variant.color,
                stock: variant.stock,
              }))}
            />
          </div>

          <div className="mt-8 rounded-xl border border-line bg-surface p-4 text-sm text-muted">
            <p className="font-semibold text-black">Upphämtning</p>
            <p className="mt-1">
              {site.pickup.place}, {site.pickup.address}
              <br />
              {site.pickup.hours}
            </p>
            <p className="mt-2">Ingen frakt – du hämtar ditt köp hos oss.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
