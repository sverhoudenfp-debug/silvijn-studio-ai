import { NextResponse } from "next/server";
import { DiscoveryOrchestrator } from "@/lib/discovery/orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** One-time guarded production smoke: mirrors the owner discovery action exactly once. Removed after use. */
export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const ownerUserId = request.headers.get("x-owner-user-id");
  if (!ownerUserId) return NextResponse.json({ error: "OWNER_REQUIRED" }, { status: 400 });
  try {
    const result = await new DiscoveryOrchestrator().runCommand({
      ownerUserId, country: "NL", city: "Eindhoven", industry: "schilder", source: "google", limit: 5,
    });
    return NextResponse.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.name : "UNKNOWN", message: error instanceof Error ? error.message : "unknown" }, { status: 502 });
  }
}
