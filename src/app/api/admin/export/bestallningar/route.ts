import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hamtaSession } from "@/lib/auth";
import { STATUS_TEXT } from "@/lib/orders";
import { oreTillKronorText } from "@/lib/format";

export const dynamic = "force-dynamic";

const RUBRIKER = [
  "Ordernummer",
  "Datum",
  "Status",
  "Namn",
  "E-post",
  "Telefon",
  "Adress",
  "Produkt",
  "Storlek",
  "Färg",
  "Antal",
  "Styckpris (kr)",
  "Radsumma (kr)",
  "Ordersumma (kr)",
];

/** Escapar ett fält enligt CSV-reglerna. */
function falt(varde: string | number | null | undefined): string {
  const text = String(varde ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

const datumFormat = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Stockholm",
});

/**
 * CSV-export av alla beställningar, en rad per artikel.
 * Semikolon som avgränsare och BOM först, så att filen öppnas rätt
 * i svensk Excel och Google Kalkylark.
 */
export async function GET() {
  const session = await hamtaSession();
  if (!session) {
    return NextResponse.json({ fel: "Ej behörig" }, { status: 401 });
  }

  const ordrar = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    include: { items: true },
  });

  const rader = [RUBRIKER.map(falt).join(";")];

  for (const order of ordrar) {
    for (const rad of order.items) {
      rader.push(
        [
          falt(order.reference),
          falt(datumFormat.format(order.createdAt)),
          falt(STATUS_TEXT[order.status]),
          falt(order.customerName),
          falt(order.customerEmail),
          falt(order.customerPhone),
          falt(order.customerAddress),
          falt(rad.productName),
          falt(rad.size),
          falt(rad.color),
          falt(rad.quantity),
          falt(oreTillKronorText(rad.unitPriceOre)),
          falt(oreTillKronorText(rad.unitPriceOre * rad.quantity)),
          falt(oreTillKronorText(order.totalOre)),
        ].join(";")
      );
    }
  }

  const filnamn = `bestallningar-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(`\uFEFF${rader.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filnamn}"`,
      "Cache-Control": "no-store",
    },
  });
}
