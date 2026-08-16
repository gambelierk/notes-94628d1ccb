import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produktbilder kan anges som vanliga URL:er (t.ex. Cloudinary, S3, Supabase Storage)
  // eller som data-URL:er (base64) som sparas i databasen. Vi använder vanliga <img>-taggar
  // i stället för next/image så att vilken extern bild-URL som helst fungerar direkt,
  // både på Render och på Netlify, utan konfiguration.
  serverExternalPackages: ["@prisma/adapter-pg", "pg"],
};

export default nextConfig;
