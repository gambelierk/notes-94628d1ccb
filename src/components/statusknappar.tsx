"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { andraOrderstatus } from "@/app/admin/actions";
import {
  foregaendeStatus,
  nastaStatus,
  NASTA_STATUS_KNAPP,
  STATUS_TEXT,
} from "@/lib/orders";
import type { OrderStatus } from "@/generated/prisma/enums";

type Props = {
  orderId: string;
  status: OrderStatus;
};

export function Statusknappar({ orderId, status }: Props) {
  const router = useRouter();
  const [fel, setFel] = useState<string | null>(null);
  const [pagar, startaOvergang] = useTransition();

  const nasta = nastaStatus(status);
  const foregaende = foregaendeStatus(status);

  function byt(nyStatus: OrderStatus) {
    setFel(null);
    startaOvergang(async () => {
      const svar = await andraOrderstatus(orderId, nyStatus);
      if (svar.fel) setFel(svar.fel);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap gap-2">
        {nasta && (
          <button
            type="button"
            disabled={pagar}
            onClick={() => byt(nasta)}
            className="knapp-primar px-3 py-2 text-sm"
          >
            {NASTA_STATUS_KNAPP[status]}
          </button>
        )}
        {foregaende && (
          <button
            type="button"
            disabled={pagar}
            onClick={() => byt(foregaende)}
            className="knapp-liten"
            title={`Flytta tillbaka till "${STATUS_TEXT[foregaende]}"`}
          >
            Ångra steg
          </button>
        )}
      </div>
      {status === "payment_claimed" && (
        <p className="text-xs text-muted">Lagersaldot dras när du markerar ordern som betald.</p>
      )}
      {fel && <p className="text-xs font-semibold">{fel}</p>}
    </div>
  );
}
