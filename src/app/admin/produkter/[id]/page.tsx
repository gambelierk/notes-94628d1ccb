import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { oreTillKronorText } from "@/lib/format";
import { Produktformular } from "@/components/produktformular";
import { uppdateraProdukt } from "@/app/admin/produkter/actions";

export const dynamic = "force-dynamic";

export default async function RedigeraProdukt({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const produkt = await prisma.product.findUnique({
    where: { id },
    include: {
      variants: { orderBy: [{ size: "asc" }, { color: "asc" }] },
      images: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!produkt) notFound();

  const lager: Record<string, number> = {};
  for (const variant of produkt.variants) {
    lager[`${variant.size}|${variant.color}`] = variant.stock;
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Redigera produkt</h1>
      <Produktformular
        action={uppdateraProdukt.bind(null, produkt.id)}
        knapptext="Spara ändringar"
        start={{
          namn: produkt.name,
          beskrivning: produkt.description,
          prisKronor: oreTillKronorText(produkt.priceOre),
          bilder: produkt.images.map((bild) => ({
            url: bild.url,
            filnamn: bild.filename,
          })),
          aktiv: produkt.active,
          sortering: produkt.sortOrder,
          storlekar: [...new Set(produkt.variants.map((variant) => variant.size))],
          farger: [...new Set(produkt.variants.map((variant) => variant.color))],
          lager,
        }}
      />
    </div>
  );
}
