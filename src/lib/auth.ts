import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const COOKIE_NAMN = "butik_admin";
const GILTIG_I_SEKUNDER = 60 * 60 * 12; // 12 timmar

type Session = { adminId: string; email: string; exp: number };

function hemlighet(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "SESSION_SECRET saknas eller är för kort. Sätt den i .env (t.ex. `openssl rand -base64 32`)."
    );
  }
  return secret;
}

function signera(data: string): string {
  return createHmac("sha256", hemlighet()).update(data).digest("base64url");
}

function paketera(session: Session): string {
  const data = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${data}.${signera(data)}`;
}

function packaUpp(token: string | undefined): Session | null {
  if (!token) return null;
  const [data, signatur] = token.split(".");
  if (!data || !signatur) return null;

  const forvantad = Buffer.from(signera(data));
  const faktisk = Buffer.from(signatur);
  if (forvantad.length !== faktisk.length || !timingSafeEqual(forvantad, faktisk)) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(data, "base64url").toString()) as Session;
    if (!session.adminId || session.exp < Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

/** Kontrollerar e-post + lösenord mot adminkontot i databasen. */
export async function verifieraInloggning(
  email: string,
  losenord: string
): Promise<{ id: string; email: string } | null> {
  const admin = await prisma.adminUser.findUnique({
    where: { email: email.trim().toLowerCase() },
  });
  if (!admin) {
    // Kör ändå en hashjämförelse så att svarstiden inte avslöjar om kontot finns.
    await bcrypt.compare(losenord, "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin");
    return null;
  }
  const giltigt = await bcrypt.compare(losenord, admin.passwordHash);
  return giltigt ? { id: admin.id, email: admin.email } : null;
}

export async function skapaSession(admin: { id: string; email: string }): Promise<void> {
  const session: Session = {
    adminId: admin.id,
    email: admin.email,
    exp: Math.floor(Date.now() / 1000) + GILTIG_I_SEKUNDER,
  };
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAMN, paketera(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GILTIG_I_SEKUNDER,
  });
}

export async function avslutaSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAMN);
}

export async function hamtaSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  return packaUpp(cookieStore.get(COOKIE_NAMN)?.value);
}

/** Använd i alla admin-sidor och admin-åtgärder. Skickar till inloggningen om sessionen saknas. */
export async function kravAdmin(): Promise<Session> {
  const session = await hamtaSession();
  if (!session) redirect("/logga-in");
  return session;
}
