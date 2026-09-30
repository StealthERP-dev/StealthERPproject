"use client";

// The session backbone for the whole app (D-21). Mounted at the root in
// app/providers.tsx — not in (vendor)/layout.tsx — so the (auth) route group
// can read session state too: that is what makes D-09's "signed in but no
// shop" state detectable (user !== null, store === null, loading === false)
// from inside Setup, distinct from "not resolved yet" (loading === true).
//
// D-13 needs no code of its own here: supabase-js's own background token
// refresh, on a non-retryable failure, removes the session and fires
// SIGNED_OUT itself — which arrives at onAuthStateChange as a null session
// and takes the exact same path as a deliberate sign-out below. Do not add a
// separate "expired" branch; there is nothing for it to distinguish.
//
// This provider now also runs on the anonymous public storefront (every
// route is under the same root layout). For an anonymous visitor,
// getSession() resolves with no session, resolve() sets user/store to null
// and loading to false, and nothing further happens — no request, no
// re-render loop. That is intended, not a regression risk to guard against
// further.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type StoreRow = Database["public"]["Tables"]["stores"]["Row"];

export interface AuthState {
  /** null once resolved and signed out. */
  user: User | null;
  /** null once resolved and this signed-in vendor has no shop (D-09) —
   * distinct from `loading`, which means "not resolved yet". */
  store: StoreRow | null;
  /** true until the first resolve completes. */
  loading: boolean;
  /** a failed store-row fetch, surfaced for Home's retry state. */
  error: Error | null;
  /** re-resolve session + store row; awaited by callers that need the new
   * state before navigating (e.g. useSignUp after a shop row lands). */
  refresh: () => Promise<void>;
}

interface InternalState {
  user: User | null;
  store: StoreRow | null;
  loading: boolean;
  error: Error | null;
}

const INITIAL_STATE: InternalState = {
  user: null,
  store: null,
  loading: true,
  error: null,
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<InternalState>(INITIAL_STATE);
  const cancelledRef = useRef(false);

  const resolve = useCallback(async (session: Session | null) => {
    if (!session?.user) {
      if (!cancelledRef.current) {
        setState({ user: null, store: null, loading: false, error: null });
      }
      return;
    }

    // maybeSingle, never single: a signed-in vendor with no stores row is a
    // normal, expected null — that distinction is D-09's entire detection
    // mechanism. `single` would turn "no shop yet" into a thrown error.
    const { data: store, error } = await supabase
      .from("stores")
      .select("*")
      .eq("owner_id", session.user.id)
      .maybeSingle();

    if (cancelledRef.current) {
      return;
    }

    if (error) {
      setState({
        user: session.user,
        store: null,
        loading: false,
        error: new Error(error.message),
      });
      return;
    }

    setState({
      user: session.user,
      store: store ?? null,
      loading: false,
      error: null,
    });
  }, []);

  useEffect(() => {
    cancelledRef.current = false;

    void supabase.auth.getSession().then(({ data }) => resolve(data.session));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      void resolve(session);
    });

    return () => {
      cancelledRef.current = true;
      sub.subscription.unsubscribe();
    };
  }, [resolve]);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await resolve(data.session);
  }, [resolve]);

  const value: AuthState = {
    user: state.user,
    store: state.store,
    loading: state.loading,
    error: state.error,
    refresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be called within an AuthProvider");
  }
  return ctx;
}
