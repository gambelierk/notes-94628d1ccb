"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Varukorgsrad = {
  /** productId|variantId – unik nyckel per rad. */
  nyckel: string;
  productId: string;
  variantId: string;
  slug: string;
  namn: string;
  storlek: string;
  farg: string;
  antal: number;
  styckprisOre: number;
  bild: string | null;
};

type VarukorgContextTyp = {
  rader: Varukorgsrad[];
  laddad: boolean;
  antalArtiklar: number;
  summaOre: number;
  laggTill: (rad: Omit<Varukorgsrad, "nyckel">) => void;
  andraAntal: (nyckel: string, antal: number) => void;
  taBort: (nyckel: string) => void;
  tomVarukorg: () => void;
};

const LAGRINGSNYCKEL = "foreningsbutik.varukorg.v1";
const MAX_ANTAL_PER_RAD = 99;

const VarukorgContext = createContext<VarukorgContextTyp | null>(null);

function lasFranLagring(): Varukorgsrad[] {
  if (typeof window === "undefined") return [];
  try {
    const rawData = window.localStorage.getItem(LAGRINGSNYCKEL);
    if (!rawData) return [];
    const parsad = JSON.parse(rawData);
    return Array.isArray(parsad) ? (parsad as Varukorgsrad[]) : [];
  } catch {
    return [];
  }
}

export function VarukorgProvider({ children }: { children: ReactNode }) {
  const [rader, setRader] = useState<Varukorgsrad[]>([]);
  const [laddad, setLaddad] = useState(false);

  useEffect(() => {
    setRader(lasFranLagring());
    setLaddad(true);
  }, []);

  useEffect(() => {
    if (!laddad) return;
    window.localStorage.setItem(LAGRINGSNYCKEL, JSON.stringify(rader));
  }, [rader, laddad]);

  const laggTill = useCallback((rad: Omit<Varukorgsrad, "nyckel">) => {
    const nyckel = `${rad.productId}|${rad.variantId}`;
    setRader((tidigare) => {
      const befintlig = tidigare.find((post) => post.nyckel === nyckel);
      if (befintlig) {
        return tidigare.map((post) =>
          post.nyckel === nyckel
            ? { ...post, antal: Math.min(post.antal + rad.antal, MAX_ANTAL_PER_RAD) }
            : post
        );
      }
      return [...tidigare, { ...rad, nyckel }];
    });
  }, []);

  const andraAntal = useCallback((nyckel: string, antal: number) => {
    setRader((tidigare) =>
      tidigare.flatMap((post) => {
        if (post.nyckel !== nyckel) return [post];
        const nyttAntal = Math.min(Math.max(antal, 0), MAX_ANTAL_PER_RAD);
        return nyttAntal === 0 ? [] : [{ ...post, antal: nyttAntal }];
      })
    );
  }, []);

  const taBort = useCallback((nyckel: string) => {
    setRader((tidigare) => tidigare.filter((post) => post.nyckel !== nyckel));
  }, []);

  const tomVarukorg = useCallback(() => setRader([]), []);

  const varde = useMemo<VarukorgContextTyp>(() => {
    return {
      rader,
      laddad,
      antalArtiklar: rader.reduce((summa, rad) => summa + rad.antal, 0),
      summaOre: rader.reduce((summa, rad) => summa + rad.antal * rad.styckprisOre, 0),
      laggTill,
      andraAntal,
      taBort,
      tomVarukorg,
    };
  }, [rader, laddad, laggTill, andraAntal, taBort, tomVarukorg]);

  return <VarukorgContext.Provider value={varde}>{children}</VarukorgContext.Provider>;
}

export function useVarukorg(): VarukorgContextTyp {
  const context = useContext(VarukorgContext);
  if (!context) {
    throw new Error("useVarukorg måste användas inuti VarukorgProvider");
  }
  return context;
}
