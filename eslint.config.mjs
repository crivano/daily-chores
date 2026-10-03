import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Código gerado (Prisma 7 gera o client em src/generated):
    "src/generated/**",
    // Service worker gerado pelo Serwist no build:
    "public/sw.js",
  ]),
]);

export default eslintConfig;
