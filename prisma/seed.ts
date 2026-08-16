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
    console.log("• Produkter finns redan – hoppar över exempelprodukterna.");
    return;
  }

  await prisma.product.create({
    data: {
      slug: "foreningstroja",
      name: "Föreningströja",
      description:
        "Mjuk t-shirt i ekologisk bomull med föreningens tryck på bröstet. Hämtas i föreningslokalen.",
      priceOre: 24900,
      sortOrder: 1,
      variants: {
        create: [
          { size: "S", color: "Svart", stock: 5 },
          { size: "M", color: "Svart", stock: 8 },
          { size: "L", color: "Svart", stock: 6 },
          { size: "S", color: "Blå", stock: 3 },
          { size: "M", color: "Blå", stock: 4 },
          { size: "L", color: "Blå", stock: 2 },
        ],
      },
    },
  });

  await prisma.product.create({
    data: {
      slug: "kaffemugg",
      name: "Kaffemugg",
      description:
        "Kaffemugg i keramik, 30 cl, med föreningens logotyp. Tål maskindisk och mikro.",
      priceOre: 9900,
      sortOrder: 2,
      variants: {
        create: [
          { size: "Onesize", color: "Vit", stock: 20 },
          { size: "Onesize", color: "Blå", stock: 12 },
        ],
      },
    },
  });

  console.log("✔ Två exempelprodukter skapade. Redigera eller ta bort dem i adminpanelen.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
