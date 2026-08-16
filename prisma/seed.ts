/**
 * Seedar adminkontot (och några exempelprodukter första gången).
 *
 *   npm run seed
 *
 * Adminkontots e-post och lösenord läses från ADMIN_EMAIL och ADMIN_PASSWORD i .env.
 * Kör kommandot igen efter att du ändrat lösenordet i .env för att uppdatera det.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL saknas. Kopiera .env.example till .env och fyll i den.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const losenord = process.env.ADMIN_PASSWORD ?? "";

  if (!email || losenord.length < 8) {
    throw new Error(
      "Sätt ADMIN_EMAIL och ADMIN_PASSWORD (minst 8 tecken) i .env innan du kör seed."
    );
  }

  const passwordHash = await bcrypt.hash(losenord, 12);
  await prisma.adminUser.upsert({
    where: { email },
    create: { email, passwordHash },
    update: { passwordHash },
  });
  console.log(`✔ Adminkonto klart: ${email}`);

  const antalProdukter = await prisma.product.count();
  if (antalProdukter > 0) {
    console.log("• Produkter finns redan – hoppar över startsortimentet.");
    return;
  }

  // Startsortiment. PRISER OCH LAGERSALDON ÄR PLATSHÅLLARE – ändra dem i
  // adminpanelen (eller här innan du seedar). Produktbilderna laddas upp i
  // adminpanelen; två bilder per tröja (framsida 001, baksida 002).
  const TSHIRT_PRIS_ORE = 24900;
  const TYGVASKA_PRIS_ORE = 14900;
  const STORLEKAR = ["S", "M", "L", "XL", "XXL"];
  const STARTLAGER = 5;

  await prisma.product.create({
    data: {
      slug: "t-shirt-ahl-about-insjon-svart",
      name: "T-shirt Åhl About Insjön – svart",
      description:
        "Svart t-shirt i bomull. Åhls vapen med korsade yxor, hjulkors och sädesax på framsidan, och trycket ”Åhl About Insjön” med kurbits på ryggen.",
      priceOre: TSHIRT_PRIS_ORE,
      sortOrder: 1,
      variants: {
        create: STORLEKAR.map((size) => ({ size, color: "Svart", stock: STARTLAGER })),
      },
    },
  });

  await prisma.product.create({
    data: {
      slug: "t-shirt-ahl-about-insjon-vit",
      name: "T-shirt Åhl About Insjön – vit",
      description:
        "Vit t-shirt i bomull. Åhls vapen med korsade yxor, hjulkors och sädesax på framsidan, och trycket ”Åhl About Insjön” med kurbits på ryggen.",
      priceOre: TSHIRT_PRIS_ORE,
      sortOrder: 2,
      variants: {
        create: STORLEKAR.map((size) => ({ size, color: "Vit", stock: STARTLAGER })),
      },
    },
  });

  await prisma.product.create({
    data: {
      slug: "tygvaska-ahl-about-insjon",
      name: "Tygväska Åhl About Insjön",
      description:
        "Svart tygväska med långa handtag och trycket ”Åhl About Insjön” omgivet av kurbits i blått och guld.",
      priceOre: TYGVASKA_PRIS_ORE,
      sortOrder: 3,
      variants: {
        create: [{ size: "Onesize", color: "Svart", stock: STARTLAGER * 2 }],
      },
    },
  });

  await prisma.product.create({
    data: {
      slug: "tygvaska-ahls-vapen",
      name: "Tygväska Åhls vapen",
      description:
        "Svart tygväska med långa handtag och Åhls vapen i blått och guld – korsade yxor, hjulkors och sädesax.",
      priceOre: TYGVASKA_PRIS_ORE,
      sortOrder: 4,
      variants: {
        create: [{ size: "Onesize", color: "Svart", stock: STARTLAGER * 2 }],
      },
    },
  });

  console.log(
    "✔ Fyra produkter skapade (två t-shirts och två tygväskor).\n" +
      "  Priser och lagersaldon är platshållare – justera dem i adminpanelen.\n" +
      "  Ladda upp produktbilderna i adminpanelen: framsidan som ..._001 och baksidan som ..._002."
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
