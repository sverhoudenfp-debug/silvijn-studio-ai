import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Host-based toegangs-bepaling:
 * - demo.silvijnstudio.com        → publieke demo-flow (/demo/...), GEEN login;
 * - questionnaire.silvijnstudio.com → publieke questionnaire-flow (/questionnaire/...), GEEN login;
 * - alle overige hosts (waaronder silvijn-studio-ai.vercel.app) → intern dashboard.
 *
 * De publieke hosts krijgen elke pad-sectie gerewrites naar de bestaande
 * publieke routes; interne dashboard-routes zijn daar dus onbereikbaar
 * (404 in plaats van /login). De interne hosts houden exact de bestaande
 * bescherming: de proxy refresht alleen de auth-cookies op de bekende
 * dashboard-prefixen en stuurt zonder sessie door naar /login; de pagina-
 * en action-guards blijven autoritatief.
 */

const DEMO_HOST = "demo.silvijnstudio.com";
const QUESTIONNAIRE_HOST = "questionnaire.silvijnstudio.com";

/** Exact dezelfde prefixen als de oorspronkelijke matcher — intern beschermd. */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/leads",
  "/lead-discovery",
  "/outreach",
  "/conversations",
  "/sales",
  "/projects",
  "/websites",
  "/generated-websites",
  "/demo-websites",
  "/analytics",
  "/settings",
  "/automation",
  "/automations",
  "/automation-runs",
  "/questionnaires",
];

function hostname(request: NextRequest): string {
  return (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
}

/** Statische bestanden en API-routes krijgen geen host-rewrite en geen auth-check. */
function isAssetPath(pathname: string): boolean {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    /\.(?:js|css|png|jpg|jpeg|svg|ico|webp|txt|xml|json|woff2?|map)$/i.test(pathname)
  );
}

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = hostname(request);

  if (host === DEMO_HOST) {
    if (isAssetPath(pathname)) return NextResponse.next();
    if (pathname === "/") return NextResponse.rewrite(new URL("/demo", request.url));
    if (pathname.startsWith("/demo/")) return NextResponse.next();
    return NextResponse.rewrite(new URL(`/demo${pathname}`, request.url));
  }

  if (host === QUESTIONNAIRE_HOST) {
    if (isAssetPath(pathname)) return NextResponse.next();
    if (pathname === "/") return NextResponse.rewrite(new URL("/questionnaire", request.url));
    if (pathname.startsWith("/questionnaire/")) return NextResponse.next();
    return NextResponse.rewrite(new URL(`/questionnaire${pathname}`, request.url));
  }

  if (!isProtectedPath(pathname)) return NextResponse.next();

  // Intern dashboard — bestaande gedrag ongewijzigd.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return NextResponse.redirect(new URL("/login?error=configuration", request.url));
  let response = NextResponse.next({ request });
  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
