import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { buildMyDigest } from "@/lib/api";
import type { MyDigestResponse } from "@/lib/types";
import { WrappedStories } from "@/components/digest/WrappedStories";
import { DigestLoading, DigestEmpty, DigestError } from "@/components/digest/DigestLoading";

export const Route = createFileRoute("/digest")({ component: DigestPage });

// The Wrapped-style story recap, opened from Settings. Full-screen overlay (WrappedStories is
// `fixed inset-0`, so it deliberately sits outside AppShell). Auth-guarded like every other
// route: redirect to /login once we know there's no user.
function DigestPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<MyDigestResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  const load = useCallback(
    (force: boolean) => {
      if (!user) return;
      if (force) setRegenerating(true);
      else setStatus("loading");
      buildMyDigest(force)
        .then((res) => {
          setData(res);
          setStatus("ready");
        })
        .catch(() => {
          // A forced regenerate that fails keeps the story on screen (we only flip the button
          // back); the first load failing shows the error state.
          if (!force) setStatus("error");
        })
        .finally(() => {
          if (force) setRegenerating(false);
        });
    },
    [user],
  );

  useEffect(() => {
    if (user) load(false);
    // Only kick off once we have a user; `load` is stable per user.
  }, [user, load]);

  if (loading || !user || status === "loading") return <DigestLoading />;
  if (status === "error" || !data) return <DigestError onRetry={() => load(false)} />;
  // Zero notes: nothing to recap.
  if (!data.digest && !data.stats) return <DigestEmpty />;

  return <WrappedStories data={data} onRegenerate={() => load(true)} regenerating={regenerating} />;
}
