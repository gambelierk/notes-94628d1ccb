import type { Metadata } from "next";
import { BekraftelseVy } from "@/components/bekraftelse-vy";

export const metadata: Metadata = { title: "Tack för din beställning" };

export default function Bekraftelsesida() {
  return <BekraftelseVy />;
}
