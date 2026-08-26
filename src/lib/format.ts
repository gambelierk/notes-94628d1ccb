/** Priser lagras i öre (heltal) för att undvika avrundningsfel. */

const priceFormatter = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** 24900 -> "249 kr", 24950 -> "249,50 kr" */
export function formatPris(ore: number): string {
  return priceFormatter.format(ore / 100);
}

/** 24950 -> "249,50" (för formulärfält i kronor) */
export function oreTillKronorText(ore: number): string {
  return (ore / 100).toFixed(2).replace(".", ",");
}

/** "249,50" eller "249.50" -> 24950. Returnerar null vid ogiltigt värde. */
export function kronorTextTillOre(text: string): number | null {
  const normaliserad = text.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normaliserad)) return null;
  return Math.round(Number(normaliserad) * 100);
}

const dateFormatter = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Stockholm",
});

export function formatDatum(datum: Date): string {
  return dateFormatter.format(datum);
}
