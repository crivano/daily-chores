-- Lista de compras dividida por locais configuráveis (ex.: Supermercado, Feira).
CREATE TABLE "ShoppingPlace" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShoppingPlace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShoppingItem" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" TEXT,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShoppingItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShoppingPlace_userId_idx" ON "ShoppingPlace"("userId");
CREATE INDEX "ShoppingItem_placeId_idx" ON "ShoppingItem"("placeId");
CREATE INDEX "ShoppingItem_userId_idx" ON "ShoppingItem"("userId");

ALTER TABLE "ShoppingPlace" ADD CONSTRAINT "ShoppingPlace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShoppingItem" ADD CONSTRAINT "ShoppingItem_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "ShoppingPlace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShoppingItem" ADD CONSTRAINT "ShoppingItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
