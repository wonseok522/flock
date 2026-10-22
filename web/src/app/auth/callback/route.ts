import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// Magic-link fallback. Works when the link opens in the same browser that
// asked for it (PKCE). Otherwise the student types the code instead.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (code) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  const back = new URL("/login", url.origin);
  back.searchParams.set("error", "That link opened in a different browser. Type the code from the email instead.");
  return NextResponse.redirect(back);
}
