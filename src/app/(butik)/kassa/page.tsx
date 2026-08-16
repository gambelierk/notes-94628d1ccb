import type { Metadata } from "next";
import { KassaVy } from "@/components/kassa-vy";

export const metadata: Metadata = { title: "Kassa" };

export default function Kassasida() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Kassa</h1>
      <KassaVy />
    </div>
  );
}
