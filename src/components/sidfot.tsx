import { site } from "@/config/site";

export function Sidfot() {
  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 text-sm text-muted">
        <p className="font-semibold text-black">{site.orgName}</p>
        <p className="mt-2">
          Upphämtning: {site.pickup.place}, {site.pickup.address}
          <br />
          Öppettider: {site.pickup.hours}
        </p>
        <p className="mt-2">
          Kontakt: {site.contactEmail} · {site.contactPhone}
        </p>
        <p className="mt-4 text-xs">
          Alla köp hämtas på plats. Ingen frakt och ingen kortbetalning – betalning sker via
          Swish.
        </p>
      </div>
    </footer>
  );
}
