import { NextResponse } from "next/server";
import { GooglePlacesDiscoveryProvider } from "@/lib/discovery/providers/google-places-provider";
import type { DiscoveryRequest } from "@/lib/discovery/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!expected || authorization !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const discoveryRequest: DiscoveryRequest = {
    country: "NL",
    city: "Eindhoven",
    industry: "schilder",
    limit: 5,
    source: "google",
  };

  try {
    const provider = new GooglePlacesDiscoveryProvider();
    const page = await provider.searchPage(discoveryRequest);
    return NextResponse.json(
      {
        ok: true,
        request: discoveryRequest,
        candidates: page.candidates,
        candidateCount: page.candidates.length,
        nextPageTokenPresent: Boolean(page.nextPageToken),
        stoppedBeforeKvk: true,
        persisted: false,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const safeCode = error instanceof Error ? error.name : "UNKNOWN_ERROR";
    const safeMessage = error instanceof Error ? error.message : "Unknown smoke-test error";
    return NextResponse.json(
      { ok: false, error: safeCode, message: safeMessage, stoppedBeforeKvk: true, persisted: false },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
