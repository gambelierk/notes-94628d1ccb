import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hamtaSession } from "@/lib/auth";
import { site } from "@/config/site";
import { InloggningsFormular } from "@/components/inloggningsformular";

export const metadata: Metadata = { title: "Logga in" };
export const dynamic = "force-dynamic";

export default async function Inloggningssida() {
  if (await hamtaSession()) redirect("/admin");

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={site.logoSrc} alt={site.orgName} className="mx-auto h-16 w-auto" />
        <h1 className="mt-4 text-2xl font-bold">Logga in</h1>
        <p className="mt-1 text-sm text-muted">Adminpanel för {site.orgName}</p>
      </div>
      <InloggningsFormular />
    </div>
  );
}
