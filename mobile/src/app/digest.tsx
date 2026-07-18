import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, useRouter } from "expo-router";
import type { MyDigestResponse } from "@clipnote/shared";
import { useAuth } from "@/contexts/auth-context";
import { buildMyDigest } from "@/lib/api";
import { WrappedStories } from "@/components/digest/WrappedStories";
import { DigestEmpty, DigestError, DigestLoading } from "@/components/digest/DigestStates";

// The Wrapped-style story recap, opened from Settings. A full-screen modal that owns its own
// solid surfaces (loading / empty / error / stories), so there's no header or chrome. Auth is
// already guarded by the root navigator; this just waits for the user before loading.
export default function DigestScreen() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<MyDigestResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [regenerating, setRegenerating] = useState(false);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [router]);

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
          // A forced regenerate that fails keeps the story on screen (only the button resets);
          // the first load failing shows the error state.
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
  }, [user, load]);

  const openNote = useCallback(
    (id: string) => {
      router.push(`/note/${id}`);
    },
    [router],
  );

  let body: React.ReactNode;
  if (loading || !user || status === "loading") {
    body = <DigestLoading />;
  } else if (status === "error" || !data) {
    body = <DigestError onRetry={() => load(false)} onClose={close} />;
  } else if (!data.digest && !data.stats) {
    // Zero notes: nothing to recap.
    body = <DigestEmpty onClose={close} />;
  } else {
    body = (
      <WrappedStories
        data={data}
        onClose={close}
        onOpenNote={openNote}
        onRegenerate={() => load(true)}
        regenerating={regenerating}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{ presentation: "fullScreenModal", headerShown: false, animation: "slide_from_bottom" }}
      />
      {body}
    </View>
  );
}
