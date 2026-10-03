import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // Runtime usa a string POOLED (sufixo -pooler). Para migrations, exporte
  // DATABASE_URL com a string DIRETA do Neon (DDL não passa pelo pooler):
  //   DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
