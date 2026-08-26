"use client";

import { loggaUt } from "@/app/admin/actions";

export function LoggaUtKnapp() {
  return (
    <form action={loggaUt}>
      <button type="submit" className="knapp-liten">
        Logga ut
      </button>
    </form>
  );
}
