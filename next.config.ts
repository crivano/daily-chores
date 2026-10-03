import withSerwist from "@serwist/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // A lib do Cloud Tasks carrega JSONs de config em runtime — não empacotar.
  serverExternalPackages: ["@google-cloud/tasks"],
};

export default withSerwist({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // Em dev o SW fica desligado (turbopack/webpack churn); para testar push:
  // npm run build && npm start.
  disable: process.env.NODE_ENV === "development",
})(nextConfig);
