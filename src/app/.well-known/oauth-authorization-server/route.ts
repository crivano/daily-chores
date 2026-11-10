import { discoveryResponse } from "@/lib/oauth-http";

// RFC 8414 — metadados do Authorization Server (o próprio app).
export const dynamic = "force-dynamic";
export const GET = discoveryResponse;
export const OPTIONS = discoveryResponse;
