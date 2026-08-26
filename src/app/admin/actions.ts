"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { avslutaSession, kravAdmin } from "@/lib/auth";
import { skaHaAvdragetLager, STATUS_ORDNING } from "@/lib/orders";
import { OrderStatus } from "@/generated/prisma/enums";

export async function loggaUt(): Promise<void> {
  await avslutaSession();
  redirect("/logga-in");
}

/**
 * Ändrar orderstatus. Lagersaldot dras när ordern går till "Betald"
 * och läggs tillbaka om ordern flyttas tillbaka till ett tidigare steg.
 * Statusändringar kan bara göras här, i adminpanelen.
 */
export async function andraOrderstatus(
  orderId: string,
  nyStatus: string
): Promise<{ fel?: string }> {
  await kravAdmin();

  if (!STATUS_ORDNING.includes(nyStatus as OrderStatus)) {
    return { fel: "Okänd status." };
  }
  const status = nyStatus as OrderStatus;

  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new Error("Beställningen hittades inte.");

    const skaDras = skaHaAvdragetLager(status);

    if (skaDras && !order.stockAdjusted) {
      for (const rad of order.items) {
        if (!rad.variantId) continue;
        await tx.variant.update({
          where: { id: rad.variantId },
          data: { stock: { decrement: rad.quantity } },
        });
      }
    } else if (!skaDras && order.stockAdjusted) {
      for (const rad of order.items) {
        if (!rad.variantId) continue;
        await tx.variant.update({
          where: { id: rad.variantId },
          data: { stock: { increment: rad.quantity } },
        });
      }
    }

    await tx.order.update({
      where: { id: orderId },
      data: { status, stockAdjusted: skaDras },
    });
  });

  revalidatePath("/admin");
  revalidatePath("/admin/produkter");
  return {};
}
