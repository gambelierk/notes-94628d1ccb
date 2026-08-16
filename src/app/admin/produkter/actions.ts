"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { kravAdmin } from "@/lib/auth";
import { kronorTextTillOre } from "@/lib/format";

export type Produktsvar = { fel: string } | undefined;

/** Max storlek på inklistrad/uppladdad bild som sparas som data-URL i databasen. */
const MAX_BILDSTORLEK = 2_000_000; // ~2 MB som text

function tillSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function delaLista(text: string): string[] {
  const varden = text
    .split(",")
    .map((del) => del.trim())
    .filter(Boolean);
  return [...new Set(varden)];
}

type Variantinmatning = { size: string; color: string; stock: number };

/** Läser lagersaldon från fält som heter `lager:<storlek>|<färg>`. */
function lasVarianter(formData: FormData, storlekar: string[], farger: string[]) {
  const varianter: Variantinmatning[] = [];
  for (const size of storlekar) {
    for (const color of farger) {
      const ravarde = formData.get(`lager:${size}|${color}`);
      const stock = Math.max(0, Math.floor(Number(ravarde ?? 0)) || 0);
      varianter.push({ size, color, stock });
    }
  }
  return varianter;
}

function lasFormular(formData: FormData) {
  const name = String(formData.get("namn") ?? "").trim();
  const description = String(formData.get("beskrivning") ?? "").trim();
  const prisText = String(formData.get("pris") ?? "").trim();
  const bild = String(formData.get("bild") ?? "").trim();
  const active = formData.get("aktiv") === "on";
  const sortOrder = Math.floor(Number(formData.get("sortering") ?? 0)) || 0;
  const storlekar = delaLista(String(formData.get("storlekar") ?? ""));
  const farger = delaLista(String(formData.get("farger") ?? ""));

  if (!name) return { ok: false, fel: "Produkten måste ha ett namn." } as const;
  if (!description) return { ok: false, fel: "Skriv en beskrivning." } as const;

  const priceOre = kronorTextTillOre(prisText);
  if (priceOre === null || priceOre <= 0) {
    return { ok: false, fel: "Ange ett giltigt pris i kronor, t.ex. 249 eller 249,50." } as const;
  }
  if (storlekar.length === 0) {
    return { ok: false, fel: 'Ange minst en storlek (skriv t.ex. "Onesize" om produkten saknar storlekar).' } as const;
  }
  if (farger.length === 0) {
    return { ok: false, fel: 'Ange minst en färg (skriv t.ex. "Enfärgad" om produkten bara finns i en färg).' } as const;
  }
  if (bild.length > MAX_BILDSTORLEK) {
    return { ok: false, fel: "Bilden är för stor. Välj en mindre bild eller ange en bild-URL." } as const;
  }

  return {
    ok: true,
    data: {
      name,
      description,
      priceOre,
      image: bild || null,
      active,
      sortOrder,
    },
    varianter: lasVarianter(formData, storlekar, farger),
  } as const;
}

async function unikSlug(bas: string, produktId?: string): Promise<string> {
  const grund = bas || "produkt";
  for (let index = 0; index < 50; index++) {
    const kandidat = index === 0 ? grund : `${grund}-${index + 1}`;
    const befintlig = await prisma.product.findUnique({ where: { slug: kandidat } });
    if (!befintlig || befintlig.id === produktId) return kandidat;
  }
  return `${grund}-${Date.now()}`;
}

export async function skapaProdukt(
  _tidigare: Produktsvar,
  formData: FormData
): Promise<Produktsvar> {
  await kravAdmin();
  const resultat = lasFormular(formData);
  if (!resultat.ok) return { fel: resultat.fel };

  const slug = await unikSlug(tillSlug(resultat.data.name));

  await prisma.product.create({
    data: {
      ...resultat.data,
      slug,
      variants: { create: resultat.varianter },
    },
  });

  revalidatePath("/admin/produkter");
  revalidatePath("/");
  redirect("/admin/produkter");
}

export async function uppdateraProdukt(
  produktId: string,
  _tidigare: Produktsvar,
  formData: FormData
): Promise<Produktsvar> {
  await kravAdmin();
  const resultat = lasFormular(formData);
  if (!resultat.ok) return { fel: resultat.fel };

  const befintlig = await prisma.product.findUnique({
    where: { id: produktId },
    include: { variants: true },
  });
  if (!befintlig) return { fel: "Produkten hittades inte." };

  const slug = await unikSlug(tillSlug(resultat.data.name), produktId);

  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: produktId },
      data: { ...resultat.data, slug },
    });

    const nyaNycklar = new Set(
      resultat.varianter.map((variant) => `${variant.size}|${variant.color}`)
    );

    // Ta bort varianter som inte längre finns kvar i formuläret.
    const attTaBort = befintlig.variants.filter(
      (variant) => !nyaNycklar.has(`${variant.size}|${variant.color}`)
    );
    if (attTaBort.length > 0) {
      await tx.variant.deleteMany({
        where: { id: { in: attTaBort.map((variant) => variant.id) } },
      });
    }

    for (const variant of resultat.varianter) {
      await tx.variant.upsert({
        where: {
          productId_size_color: {
            productId: produktId,
            size: variant.size,
            color: variant.color,
          },
        },
        create: { productId: produktId, ...variant },
        update: { stock: variant.stock },
      });
    }
  });

  revalidatePath("/admin/produkter");
  revalidatePath("/");
  revalidatePath(`/produkt/${slug}`);
  redirect("/admin/produkter");
}

export async function taBortProdukt(formData: FormData): Promise<void> {
  await kravAdmin();
  const produktId = String(formData.get("produktId") ?? "");
  if (!produktId) return;

  await prisma.product.delete({ where: { id: produktId } });

  revalidatePath("/admin/produkter");
  revalidatePath("/");
}
