import { NextResponse } from "next/server";
/** Public liveness only. Detailed configuration is restricted to the owner. */
export function GET() {
  return NextResponse.json({ status: "ok", service: "silvijn-studio-ai" }, { headers: { "cache-control": "no-store" } });
}
