"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { loggaIn, type Inloggningssvar } from "@/app/logga-in/actions";

function Skickaknapp() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="knapp-primar w-full">
      {pending ? "Loggar in …" : "Logga in"}
    </button>
  );
}

export function InloggningsFormular() {
  const [status, formAction] = useActionState<Inloggningssvar, FormData>(loggaIn, undefined);
  // Kontrollerat fält: annars nollställs e-posten när formuläret renderas om
  // efter ett misslyckat inloggningsförsök.
  const [epost, setEpost] = useState("");

  return (
    <form action={formAction} className="kort space-y-4 p-6">
      <div>
        <label className="etikett" htmlFor="epost">
          E-post
        </label>
        <input
          id="epost"
          name="epost"
          type="email"
          required
          autoComplete="username"
          className="falt"
          value={epost}
          onChange={(event) => setEpost(event.target.value)}
        />
      </div>
      <div>
        <label className="etikett" htmlFor="losenord">
          Lösenord
        </label>
        <input
          id="losenord"
          name="losenord"
          type="password"
          required
          autoComplete="current-password"
          className="falt"
        />
      </div>

      {status?.fel && (
        <p className="rounded-lg border border-black bg-surface p-3 text-sm font-semibold">
          {status.fel}
        </p>
      )}

      <Skickaknapp />

      <Link href="/" className="block text-center text-sm font-semibold text-blue hover:underline">
        Till butiken
      </Link>
    </form>
  );
}
