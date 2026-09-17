import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/** Never trusts getSession(), user_metadata, a client-supplied role or a UI button. */
export async function getSessionClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) throw new Error("BLOCKED_EXTERNAL_CONFIGURATION: Supabase authentication configuration missing");
  const store = await cookies();
  return createServerClient(url, key, {
    cookieOptions: { sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        try { values.forEach(({ name, value, options }) => store.set(name, value, options)); }
        catch { /* Server Components cannot update cookies; proxy refreshes them. */ }
      },
    },
  });
}

export async function requireStudioOwner() {
  const client = await getSessionClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user || !user.email_confirmed_at) redirect("/login");
  const { data: owner, error: roleError } = await client.rpc("is_studio_owner");
  if (roleError || owner !== true) redirect("/login?error=access_denied");
  return { client, user };
}

export async function humanRpc(name: string, args: Record<string, unknown>) {
  const { client } = await requireStudioOwner();
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
