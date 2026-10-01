import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "./env";

const PROTECTED_PREFIXES = ["/library", "/crates", "/plans"];
const AUTH_PAGES = ["/login", "/signup"];

/** Refreshes the auth session cookie and guards app routes. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key } = supabaseEnv();

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() revalidates the token with Supabase Auth; do not replace it with getSession().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  if (!user && PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    target.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(target);
  }
  if (user && AUTH_PAGES.includes(path)) {
    const target = request.nextUrl.clone();
    target.pathname = "/library";
    target.search = "";
    return NextResponse.redirect(target);
  }
  return response;
}
