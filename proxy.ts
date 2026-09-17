import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Refreshes verified auth cookies. Page/action guards remain authoritative. */
export async function proxy(request: NextRequest) {
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
  matcher: ["/dashboard/:path*", "/leads/:path*", "/lead-discovery/:path*", "/outreach/:path*", "/conversations/:path*", "/sales/:path*", "/projects/:path*", "/websites/:path*", "/generated-websites/:path*", "/demo-websites/:path*", "/analytics/:path*", "/settings/:path*", "/automation/:path*", "/automations/:path*", "/automation-runs/:path*"],
};
