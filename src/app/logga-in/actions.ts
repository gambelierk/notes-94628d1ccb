"use server";

import { redirect } from "next/navigation";
import { skapaSession, verifieraInloggning } from "@/lib/auth";

export type Inloggningssvar = { fel: string } | undefined;

export async function loggaIn(
  _tidigare: Inloggningssvar,
  formData: FormData
): Promise<Inloggningssvar> {
  const email = String(formData.get("epost") ?? "");
  const losenord = String(formData.get("losenord") ?? "");

  if (!email || !losenord) {
    return { fel: "Fyll i både e-post och lösenord." };
  }

  const admin = await verifieraInloggning(email, losenord);
  if (!admin) {
    return { fel: "Fel e-post eller lösenord." };
  }

  await skapaSession(admin);
  redirect("/admin");
}
