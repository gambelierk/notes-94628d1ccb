"use client";

import { taBortProdukt } from "@/app/admin/produkter/actions";

export function TaBortProdukt({ produktId, namn }: { produktId: string; namn: string }) {
  return (
    <form
      action={taBortProdukt}
      onSubmit={(event) => {
        const godkant = window.confirm(
          `Ta bort "${namn}"? Produkten försvinner ur butiken. Tidigare beställningar påverkas inte.`
        );
        if (!godkant) event.preventDefault();
      }}
    >
      <input type="hidden" name="produktId" value={produktId} />
      <button type="submit" className="knapp-liten">
        Ta bort
      </button>
    </form>
  );
}
