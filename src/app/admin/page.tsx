import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDatum, formatPris } from "@/lib/format";
import { STATUS_ORDNING, STATUS_TEXT } from "@/lib/orders";
import { Statusknappar } from "@/components/statusknappar";
import type { OrderStatus } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const STATUS_FARG: Record<OrderStatus, string> = {
  awaiting_payment: "bg-surface text-black",
  payment_claimed: "bg-blue-soft text-blue",
  paid: "bg-blue text-white",
  picked_up: "bg-black text-white",
};

export default async function Bestallningar({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusFilter } = await searchParams;
  const aktivtFilter = STATUS_ORDNING.includes(statusFilter as OrderStatus)
    ? (statusFilter as OrderStatus)
    : null;

  const [ordrar, antalPerStatus] = await Promise.all([
    prisma.order.findMany({
      where: aktivtFilter ? { status: aktivtFilter } : undefined,
      orderBy: { createdAt: "desc" },
      include: { items: true },
      take: 200,
    }),
    prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  function antal(status: OrderStatus): number {
    return antalPerStatus.find((post) => post.status === status)?._count._all ?? 0;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Beställningar</h1>
        <a href="/api/admin/export/bestallningar" className="knapp-svart px-4 py-2 text-sm">
          Exportera CSV
        </a>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/admin"
          className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
            aktivtFilter ? "border-line bg-white" : "border-blue bg-blue text-white"
          }`}
        >
          Alla
        </Link>
        {STATUS_ORDNING.map((status) => (
          <Link
            key={status}
            href={`/admin?status=${status}`}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
              aktivtFilter === status ? "border-blue bg-blue text-white" : "border-line bg-white"
            }`}
          >
            {STATUS_TEXT[status]} ({antal(status)})
          </Link>
        ))}
      </div>

      {ordrar.length === 0 ? (
        <p className="kort p-6 text-muted">Inga beställningar att visa.</p>
      ) : (
        <ul className="space-y-3">
          {ordrar.map((order) => (
            <li key={order.id} className="kort p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-bold tracking-widest">{order.reference}</p>
                  <p className="text-sm text-muted">{formatDatum(order.createdAt)}</p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${STATUS_FARG[order.status]}`}
                >
                  {STATUS_TEXT[order.status]}
                </span>
              </div>

              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div className="text-sm">
                  <p className="font-semibold">Kund</p>
                  <p className="text-muted">
                    {order.customerName}
                    <br />
                    <a href={`mailto:${order.customerEmail}`} className="underline">
                      {order.customerEmail}
                    </a>
                    <br />
                    <a href={`tel:${order.customerPhone}`} className="underline">
                      {order.customerPhone}
                    </a>
                    {order.customerAddress && (
                      <>
                        <br />
                        {order.customerAddress}
                      </>
                    )}
                  </p>
                </div>

                <div className="text-sm">
                  <p className="font-semibold">Artiklar</p>
                  <ul className="text-muted">
                    {order.items.map((rad) => (
                      <li key={rad.id}>
                        {rad.quantity} × {rad.productName} ({rad.size || "–"} / {rad.color || "–"})
                        {" – "}
                        {formatPris(rad.unitPriceOre * rad.quantity)}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 font-bold text-black">
                    Totalt: {formatPris(order.totalOre)}
                  </p>
                </div>
              </div>

              <div className="mt-4 border-t border-line pt-3">
                <Statusknappar orderId={order.id} status={order.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
