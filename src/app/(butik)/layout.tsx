import { Sidhuvud } from "@/components/sidhuvud";
import { Sidfot } from "@/components/sidfot";

export default function ButikLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Sidhuvud />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
      <Sidfot />
    </div>
  );
}
