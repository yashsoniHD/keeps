/**
 * Clipnote Landing Page — production route.
 *
 * Logged-out visitors are routed here (see routes/index.tsx) so cold traffic
 * sees the pitch + a working signup CTA instead of the bare sign-in screen.
 *
 * The component itself lives in `marketing/landing-page.tsx`; this wrapper keeps
 * the marketing copy as the single source of truth and supplies the real
 * behaviour:
 *   - onTry(url): stash the pasted URL and route to sign-in. After Google auth
 *     the feed (routes/index.tsx) detects `clipnote.pendingCapture` and fires the
 *     capture automatically — so "Try it free" lands a real first note.
 *   - onSignIn(): route straight to sign-in.
 * Already-authed users are bounced to the feed.
 *
 * Note: TanStack Router file-based routing requires the `createFileRoute`
 * factory — exporting a raw `Route` object breaks at runtime because the
 * router calls `Route.update()` on navigation.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { captureSignupRef } from "@/lib/attribution";
import LandingPage from "../../../marketing/landing-page";

export const Route = createFileRoute("/landing")({
  component: LandingRoute,
  validateSearch: (search: Record<string, unknown>) => ({
    // Acquisition source (e.g. "shared-note"); read for attribution on signup.
    ref: typeof search.ref === "string" ? search.ref : undefined,
  }),
});

function LandingRoute() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  // Remember where this visitor came from (?ref= / utm) for signup attribution.
  useEffect(() => {
    captureSignupRef();
  }, []);

  // A returning, signed-in user has no business on the marketing page.
  useEffect(() => {
    if (!loading && user) navigate({ to: "/" });
  }, [user, loading, navigate]);

  const handleTry = (url: string) => {
    try {
      localStorage.setItem("clipnote.pendingCapture", url);
    } catch {
      /* storage disabled — the user can still paste again after signing in */
    }
    navigate({ to: "/login" });
  };

  return (
    <LandingPage onTry={handleTry} onSignIn={() => navigate({ to: "/login" })} />
  );
}

export default LandingPage;
