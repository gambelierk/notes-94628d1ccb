import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

type Client = InstanceType<typeof PrismaClient>;

const globalForPrisma = globalThis as unknown as { prismaClient?: Client };

function createClient(): Client {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL saknas. Kopiera .env.example till .env och fyll i din Postgres-anslutning."
    );
  }
  // Driver-adaptern använder vanlig Postgres över TCP och fungerar därför
  // likadant mot Render Postgres, Neon och Supabase.
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

function getClient(): Client {
  if (!globalForPrisma.prismaClient) {
    globalForPrisma.prismaClient = createClient();
  }
  return globalForPrisma.prismaClient;
}

/**
 * Prisma-klienten skapas först när den faktiskt används (lat initiering),
 * så att `next build` kan köras utan att DATABASE_URL är satt.
 */
export const prisma = new Proxy({} as Client, {
  get(_target, property) {
    const client = getClient() as unknown as Record<string | symbol, unknown>;
    const value = client[property];
    return typeof value === "function" ? value.bind(client) : value;
  },
});
