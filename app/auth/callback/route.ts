import { NextResponse, type NextRequest } from "next/server";
import { getSessionClient } from "@/lib/auth/server";
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const client = await getSessionClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data: owner } = await client.rpc("is_studio_owner");
      if (owner === true) return NextResponse.redirect(new URL("/dashboard", request.url));
      await client.auth.signOut();
    }
  }
  return NextResponse.redirect(new URL("/login?error=access_denied", request.url));
}
