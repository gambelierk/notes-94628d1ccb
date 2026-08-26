"use server";

import { prisma } from "@/lib/prisma";
import { genereraReferens } from "@/lib/orders";
import { skickaAdminavisering, skickaKundbekraftelse } from "@/lib/email";

export type Bestallningsrad = {
  variantId: string;
  antal: number;
};

export type Kunduppgifter = {
  namn: string;
  epost: string;
  telefon: string;
  adress: string;
};

export type OrderKvitto = {
  referens: string;
  namn: string;
  epost: string;
  totalOre: number;
  rader: {
    namn: string;
    storlek: string;
    farg: string;
    antal: number;
    styckprisOre: number;
  }[];
};

export type Bestallningssvar =
  | { ok: true; kvitto: OrderKvitto }
  | { ok: false; fel: string };

const EPOST_MONSTER = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Skapar en beställning med status "payment_claimed".
 * Lagersaldot rörs INTE här – det dras först när en administratör markerar
 * ordern som betald i adminpanelen.
 */
export async function skapaBestallning(
  kund: Kunduppgifter,
  rader: Bestallningsrad[]
): Promise<Bestallningssvar> {
  const namn = kund.namn?.trim() ?? "";
  const epost = kund.epost?.trim().toLowerCase() ?? "";
  const telefon = kund.telefon?.trim() ?? "";
  const adress = kund.adress?.trim() ?? "";

  if (!namn) return { ok: false, fel: "Fyll i ditt namn." };
  if (!epost || !EPOST_MONSTER.test(epost)) {
    return { ok: false, fel: "Fyll i en giltig e-postadress." };
  }
  if (!telefon || telefon.replace(/\D/g, "").length < 6) {
    return { ok: false, fel: "Fyll i ett giltigt telefonnummer." };
  }
  if (!Array.isArray(rader) || rader.length === 0) {
    return { ok: false, fel: "Varukorgen är tom." };
  }

  // Slå ihop eventuella dubbletter och kontrollera antalen.
  const antalPerVariant = new Map<string, number>();
  for (const rad of rader) {
    const antal = Math.floor(Number(rad.antal));
    if (!rad.variantId || !Number.isFinite(antal) || antal < 1 || antal > 99) {
      return { ok: false, fel: "Ogiltigt antal i varukorgen." };
    }
    antalPerVariant.set(rad.variantId, (antalPerVariant.get(rad.variantId) ?? 0) + antal);
  }

  const varianter = await prisma.variant.findMany({
    where: { id: { in: [...antalPerVariant.keys()] } },
    include: { product: true },
  });

  if (varianter.length !== antalPerVariant.size) {
    return {
      ok: false,
      fel: "Någon av produkterna i varukorgen finns inte längre. Uppdatera varukorgen och försök igen.",
    };
  }

  // Priser hämtas alltid från databasen – aldrig från webbläsaren.
  const orderrader = varianter.map((variant) => ({
    variantId: variant.id,
    productId: variant.productId,
    productName: variant.product.name,
    size: variant.size,
    color: variant.color,
    quantity: antalPerVariant.get(variant.id) as number,
    unitPriceOre: variant.product.priceOre,
  }));

  for (const variant of varianter) {
    const onskatAntal = antalPerVariant.get(variant.id) as number;
    if (!variant.product.active) {
      return { ok: false, fel: `${variant.product.name} går tyvärr inte att beställa längre.` };
    }
    if (variant.stock < onskatAntal) {
      return {
        ok: false,
        fel: `Det finns bara ${variant.stock} kvar av ${variant.product.name} (${variant.size}/${variant.color}). Ändra antalet i varukorgen.`,
      };
    }
  }

  const totalOre = orderrader.reduce(
    (summa, rad) => summa + rad.unitPriceOre * rad.quantity,
    0
  );

  // Skapa ordern med en unik referenskod (nytt försök vid krock).
  let order: { id: string; reference: string } | null = null;
  for (let forsok = 0; forsok < 5 && !order; forsok++) {
    const reference = genereraReferens();
    try {
      order = await prisma.order.create({
        data: {
          reference,
          customerName: namn,
          customerEmail: epost,
          customerPhone: telefon,
          customerAddress: adress || null,
          status: "payment_claimed",
          totalOre,
          items: { create: orderrader },
        },
        select: { id: true, reference: true },
      });
    } catch (error) {
      const kod = (error as { code?: string }).code;
      if (kod !== "P2002") throw error;
    }
  }

  if (!order) {
    return { ok: false, fel: "Kunde inte skapa beställningen. Försök igen om en stund." };
  }

  const mejlorder = {
    reference: order.reference,
    customerName: namn,
    customerEmail: epost,
    customerPhone: telefon,
    customerAddress: adress || null,
    totalOre,
    items: orderrader.map((rad) => ({
      productName: rad.productName,
      size: rad.size,
      color: rad.color,
      quantity: rad.quantity,
      unitPriceOre: rad.unitPriceOre,
    })),
  };

  // Ett misslyckat mejlutskick får inte hindra att beställningen registreras.
  await Promise.allSettled([
    skickaKundbekraftelse(mejlorder),
    skickaAdminavisering(mejlorder),
  ]).then((resultat) => {
    for (const post of resultat) {
      if (post.status === "rejected") console.error("[e-post] Utskick misslyckades:", post.reason);
    }
  });

  return {
    ok: true,
    kvitto: {
      referens: order.reference,
      namn,
      epost,
      totalOre,
      rader: orderrader.map((rad) => ({
        namn: rad.productName,
        storlek: rad.size,
        farg: rad.color,
        antal: rad.quantity,
        styckprisOre: rad.unitPriceOre,
      })),
    },
  };
}
