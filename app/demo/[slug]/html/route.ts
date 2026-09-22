import { NextResponse } from "next/server";
import { getDemoRepository } from "@/lib/repositories/demo-repository";
import { slugContainsPathTraversal } from "@/lib/websites/slug";

/**
 * G4 — publiek HTML-document van een theme_page-demo. Wordt door /demo/[slug]
 * in een gesandboxte iframe getoond. Alleen ready theme_page-demo's; alles
 * anders 404. Strikte CSP: het document is zelfstandig (inline CSS/JS/data-
 * URI's) en mag nergens naartoe verbinden of formulieren posten.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!slug || slug.length > 120 || slugContainsPathTraversal(slug) || !/^[a-z0-9-]+$/.test(slug)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const html = await getDemoRepository().getRenderedHtmlBySlug(slug);
  if (!html) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=600",
      "x-robots-tag": "noindex",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'",
      "referrer-policy": "no-referrer",
    },
  });
}
