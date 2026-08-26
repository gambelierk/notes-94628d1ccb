import "server-only";
import { Resend } from "resend";
import { site, notificationEmail } from "@/config/site";
import { formatPris } from "@/lib/format";

export type Mejlrad = {
  productName: string;
  size: string;
  color: string;
  quantity: number;
  unitPriceOre: number;
};

export type MejlOrder = {
  reference: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress?: string | null;
  totalOre: number;
  items: Mejlrad[];
};

type Utskick = { to: string; subject: string; html: string; text: string };

/**
 * Skickar mejl via Resend. Saknas RESEND_API_KEY loggas mejlet i konsolen i stället,
 * så att man kan utveckla och testa utan e-postkonto.
 */
async function skicka({ to, subject, html, text }: Utskick): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.info(
      `[e-post] RESEND_API_KEY/EMAIL_FROM saknas – mejlet skickades inte.\nTill: ${to}\nÄmne: ${subject}\n\n${text}`
    );
    return;
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({ from, to, subject, html, text });
  if (error) {
    throw new Error(`Kunde inte skicka mejl till ${to}: ${error.message}`);
  }
}

function variantText(rad: Mejlrad): string {
  const delar = [rad.size, rad.color].filter((del) => del && del !== "-");
  return delar.length ? delar.join(" / ") : "–";
}

function radTabellHtml(items: Mejlrad[], totalOre: number): string {
  const rader = items
    .map(
      (rad) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb">
          <strong>${escapeHtml(rad.productName)}</strong><br />
          <span style="color:#555">Storlek: ${escapeHtml(rad.size || "–")} · Färg: ${escapeHtml(rad.color || "–")}</span>
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap">
          ${rad.quantity} st × ${formatPris(rad.unitPriceOre)}<br />
          <strong>${formatPris(rad.unitPriceOre * rad.quantity)}</strong>
        </td>
      </tr>`
    )
    .join("");

  return `
    <table style="width:100%;border-collapse:collapse;font-size:15px">
      ${rader}
      <tr>
        <td style="padding:12px 0"><strong>Totalt</strong></td>
        <td style="padding:12px 0;text-align:right"><strong>${formatPris(totalOre)}</strong></td>
      </tr>
    </table>`;
}

function radTabellText(items: Mejlrad[], totalOre: number): string {
  const rader = items
    .map(
      (rad) =>
        `- ${rad.productName} (${variantText(rad)}) – ${rad.quantity} st × ${formatPris(
          rad.unitPriceOre
        )} = ${formatPris(rad.unitPriceOre * rad.quantity)}`
    )
    .join("\n");
  return `${rader}\n\nTotalt: ${formatPris(totalOre)}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const upphamtningText = `${site.pickup.place}
${site.pickup.address}
Öppettider: ${site.pickup.hours}
${site.pickup.note}`;

/** Bekräftelse till kunden (svenska). */
export async function skickaKundbekraftelse(order: MejlOrder): Promise<void> {
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:560px">
    <h1 style="font-size:20px">Tack för din beställning!</h1>
    <p>Hej ${escapeHtml(order.customerName)},</p>
    <p>Vi har tagit emot din beställning hos ${escapeHtml(site.orgName)}.
    Så snart vi har stämt av din Swish-betalning markerar vi ordern som betald.</p>

    <p style="font-size:18px">
      Ordernummer: <strong style="letter-spacing:2px">${escapeHtml(order.reference)}</strong>
    </p>

    <h2 style="font-size:16px;margin-top:24px">Din beställning</h2>
    ${radTabellHtml(order.items, order.totalOre)}

    <h2 style="font-size:16px;margin-top:24px">Upphämtning</h2>
    <p style="white-space:pre-line">${escapeHtml(upphamtningText)}</p>

    <p style="color:#555;font-size:14px;margin-top:24px">
      Frågor? Svara på det här mejlet eller kontakta oss på
      ${escapeHtml(site.contactEmail)} / ${escapeHtml(site.contactPhone)}.
    </p>
  </div>`;

  const text = `Tack för din beställning!

Hej ${order.customerName},

Vi har tagit emot din beställning hos ${site.orgName}. Så snart vi har stämt av din Swish-betalning markerar vi ordern som betald.

Ordernummer: ${order.reference}

Din beställning:
${radTabellText(order.items, order.totalOre)}

Upphämtning:
${upphamtningText}

Frågor? Kontakta oss på ${site.contactEmail} / ${site.contactPhone}.`;

  await skicka({
    to: order.customerEmail,
    subject: `Din beställning ${order.reference} – ${site.orgName}`,
    html,
    text,
  });
}

/** Avisering till föreningens inkorg (svenska). */
export async function skickaAdminavisering(order: MejlOrder): Promise<void> {
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:560px">
    <h1 style="font-size:20px">Ny beställning ${escapeHtml(order.reference)}</h1>
    <p>
      <strong>Namn:</strong> ${escapeHtml(order.customerName)}<br />
      <strong>E-post:</strong> ${escapeHtml(order.customerEmail)}<br />
      <strong>Telefon:</strong> ${escapeHtml(order.customerPhone)}<br />
      <strong>Adress:</strong> ${escapeHtml(order.customerAddress || "–")}
    </p>
    ${radTabellHtml(order.items, order.totalOre)}
    <p style="color:#555;font-size:14px">
      Kunden har uppgett att betalningen är gjord. Kontrollera Swish och markera ordern som
      betald i adminpanelen – lagersaldot dras först då.
    </p>
  </div>`;

  const text = `Ny beställning ${order.reference}

Namn: ${order.customerName}
E-post: ${order.customerEmail}
Telefon: ${order.customerPhone}
Adress: ${order.customerAddress || "–"}

${radTabellText(order.items, order.totalOre)}

Kunden har uppgett att betalningen är gjord. Kontrollera Swish och markera ordern som betald i adminpanelen – lagersaldot dras först då.`;

  await skicka({
    to: notificationEmail(),
    subject: `Ny beställning ${order.reference} (${formatPris(order.totalOre)})`,
    html,
    text,
  });
}
