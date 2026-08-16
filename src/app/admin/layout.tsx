import Link from "next/link";
import { kravAdmin } from "@/lib/auth";
import { site } from "@/config/site";
import { LoggaUtKnapp } from "@/components/logga-ut-knapp";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await kravAdmin();

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="border-b border-line bg-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-base font-bold">Adminpanel</p>
              <p className="text-xs text-muted">
                {site.orgName} · inloggad som {session.email}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/" className="knapp-liten">
                Visa butiken
              </Link>
              <LoggaUtKnapp />
            </div>
          </div>

          <nav className="mt-3 flex gap-2">
            <Link
              href="/admin"
              className="rounded-lg px-3 py-2 text-sm font-semibold hover:bg-surface"
            >
              Beställningar
            </Link>
            <Link
              href="/admin/produkter"
              className="rounded-lg px-3 py-2 text-sm font-semibold hover:bg-surface"
            >
              Produkter
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
