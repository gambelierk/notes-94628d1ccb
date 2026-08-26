import type { Metadata } from "next";
import { VarukorgVy } from "@/components/varukorg-vy";

export const metadata: Metadata = { title: "Varukorg" };

export default function Varukorgssida() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Varukorg</h1>
      <VarukorgVy />
    </div>
  );
}
