import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma CLI-konfiguration. Databasanslutningen läses alltid från DATABASE_URL,
// vilket fungerar med Render Postgres, Neon och Supabase utan kodändringar.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
