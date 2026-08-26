/**
 * Hjälpfunktioner för produktbilder som hör ihop via filnamnet.
 *
 * Bilder till samma produkt namnges ofta likadant med en löpande siffra sist,
 * t.ex. "tshirt_svart_001.jpg", "tshirt_svart_002.jpg". Då ska de hamna i rätt
 * ordning – 001 först (huvudbild), sedan 002 och så vidare – oavsett i vilken
 * ordning filerna råkar väljas i filväljaren.
 */

export type Bildnamn = {
  /** Namnet utan siffror på slutet och utan filändelse, t.ex. "tshirt_svart". */
  stam: string;
  /** Siffran på slutet som tal, t.ex. 1 för "..._001". Saknas den blir den null. */
  nummer: number | null;
};

/** Delar upp ett filnamn i stam och löpnummer. */
export function delaBildnamn(filnamn: string): Bildnamn {
  const utanSokvag = filnamn.split(/[\\/]/).pop() ?? filnamn;
  const utanAndelse = utanSokvag.replace(/\.[a-z0-9]{1,5}$/i, "");
  const traff = utanAndelse.match(/^(.*?)[\s._-]*(\d+)$/);

  if (!traff) return { stam: utanAndelse.trim().toLowerCase(), nummer: null };

  return {
    stam: traff[1].trim().toLowerCase(),
    nummer: Number.parseInt(traff[2], 10),
  };
}

const kollator = new Intl.Collator("sv", { sensitivity: "base", numeric: true });

/**
 * Sorterar filnamn så att bilder med samma stam grupperas ihop och ordnas på
 * sitt löpnummer: tshirt_svart_001 → tshirt_svart_002 → tshirt_svart_010.
 * Bilder utan siffra läggs först inom sin grupp.
 */
export function jamforBildnamn(a: string, b: string): number {
  const forsta = delaBildnamn(a);
  const andra = delaBildnamn(b);

  if (forsta.stam !== andra.stam) return kollator.compare(forsta.stam, andra.stam);
  if (forsta.nummer === andra.nummer) return kollator.compare(a, b);
  if (forsta.nummer === null) return -1;
  if (andra.nummer === null) return 1;
  return forsta.nummer - andra.nummer;
}

/** Sorterar en lista objekt som har ett filnamn. */
export function sorteraPaFilnamn<T>(poster: T[], hamtaFilnamn: (post: T) => string): T[] {
  return [...poster].sort((a, b) => jamforBildnamn(hamtaFilnamn(a), hamtaFilnamn(b)));
}

/**
 * Grupperar filnamn på stam. Används för att upptäcka när en och samma
 * uppladdning innehåller bilder som hör till flera olika produkter.
 */
export function grupperaPaStam<T>(poster: T[], hamtaFilnamn: (post: T) => string): Map<string, T[]> {
  const grupper = new Map<string, T[]>();
  for (const post of poster) {
    const { stam } = delaBildnamn(hamtaFilnamn(post));
    const befintlig = grupper.get(stam);
    if (befintlig) befintlig.push(post);
    else grupper.set(stam, [post]);
  }
  return grupper;
}
