"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "./supabase/client";
import { supabaseConfigured } from "./supabase/env";
import { friendlyError } from "./errors";
import type { Member } from "./types";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; member: Member };

/** Loads the signed-in member; sends signed-out users to /login and new users to /onboard. */
export function useMember(): State & { reload: () => void } {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabaseConfigured) {
        setState({ status: "error", message: "Supabase isn't configured yet (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY)." });
        return;
      }
      try {
        const sb = supabase();
        const { data: auth } = await sb.auth.getUser();
        if (!auth.user) {
          router.replace("/login");
          return;
        }
        const { data, error } = await sb
          .from("members")
          .select("id, first_name, uni_domain, github_handle, trust_score, trust_reasons, safe_walks, verified_at")
          .eq("id", auth.user.id)
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          router.replace("/onboard");
          return;
        }
        // Shared blocklist: a confirmed bad actor loses access everywhere (best effort check).
        const { data: blocked } = await sb.rpc("am_i_blocked");
        if (blocked === true) {
          if (!cancelled) setState({ status: "error", message: friendlyError("blocked") });
          return;
        }
        if (!cancelled) setState({ status: "ready", member: data as Member });
      } catch (e) {
        if (!cancelled) setState({ status: "error", message: friendlyError(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, nonce]);

  return { ...state, reload };
}
