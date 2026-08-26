-- Flera bilder per produkt: Product."image" ersätts av tabellen "ProductImage".
-- Befintliga bilder flyttas över innan kolumnen tas bort, så inget bildmaterial går förlorat.

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductImage_productId_sortOrder_idx" ON "ProductImage"("productId", "sortOrder");

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Flytta över befintliga bilder som huvudbild (sortOrder = 0).
INSERT INTO "ProductImage" ("id", "productId", "url", "sortOrder")
SELECT gen_random_uuid()::text, "id", "image", 0
FROM "Product"
WHERE "image" IS NOT NULL AND "image" <> '';

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "image";
