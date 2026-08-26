import { randomInt } from "node:crypto";
import { OrderStatus } from "@/generated/prisma/enums";

/** Tecken utan lättförväxlade bokstäver/siffror (inga O, 0, I, 1). */
const ALFABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Kort referenskod, t.ex. "K7QF2M". */
export function genereraReferens(langd = 6): string {
  let kod = "";
  for (let i = 0; i < langd; i++) {
    kod += ALFABET[randomInt(ALFABET.length)];
  }
  return kod;
}

export const STATUS_ORDNING: OrderStatus[] = [
  OrderStatus.awaiting_payment,
  OrderStatus.payment_claimed,
  OrderStatus.paid,
  OrderStatus.picked_up,
];

export const STATUS_TEXT: Record<OrderStatus, string> = {
  awaiting_payment: "Väntar på betalning",
  payment_claimed: "Betalning uppgiven",
  paid: "Betald",
  picked_up: "Uthämtad",
};

/** Knapptext för att flytta ordern till nästa steg. */
export const NASTA_STATUS_KNAPP: Record<OrderStatus, string | null> = {
  awaiting_payment: "Markera som betalning uppgiven",
  payment_claimed: "Markera som betald",
  paid: "Markera som uthämtad",
  picked_up: null,
};

export function nastaStatus(status: OrderStatus): OrderStatus | null {
  const index = STATUS_ORDNING.indexOf(status);
  return index >= 0 && index < STATUS_ORDNING.length - 1
    ? STATUS_ORDNING[index + 1]
    : null;
}

export function foregaendeStatus(status: OrderStatus): OrderStatus | null {
  const index = STATUS_ORDNING.indexOf(status);
  return index > 0 ? STATUS_ORDNING[index - 1] : null;
}

/** Statusar där lagersaldot ska vara avdraget. */
export function skaHaAvdragetLager(status: OrderStatus): boolean {
  return status === OrderStatus.paid || status === OrderStatus.picked_up;
}
