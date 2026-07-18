import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { Smartphone, Trash2 } from "lucide-react-native";

import { listTokens, revokeToken, type ShortcutToken } from "@/lib/api";
import {
  clearSharedPat,
  isAppPatLabel,
  sharedPatLabel,
  storedPatTokenId,
} from "@/lib/shared-credentials";
import { interopIcon } from "@/lib/note-meta";

// className styling on SVG icons requires interop registration (see note-meta / settings).
[Smartphone, Trash2].forEach(interopIcon);

// A friendly short date ("12 Jun 2026") from the ISO string the backend serialises.
function fmtDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// "Connected devices": every Personal Access Token on the account — the app's own share-extension
// token (tagged "This device") plus any the user made elsewhere (an iOS Shortcut). Revoking a
// token immediately cuts off that device; revoking this device also drops the local Keychain
// copy so the app re-mints a fresh token on next foreground.
export function ConnectedDevices() {
  const [tokens, setTokens] = useState<ShortcutToken[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  // Identify "this device" by the Keychain token's id, not by label — the label is derived
  // from the device name and stops matching if the user renames their phone after minting.
  // The label stays as a fallback for the window before the async id read resolves.
  const [thisDeviceTokenId, setThisDeviceTokenId] = useState<string | null>(null);
  const thisDeviceLabel = sharedPatLabel();
  const isThisDeviceToken = useCallback(
    (t: ShortcutToken) => (thisDeviceTokenId ? t.id === thisDeviceTokenId : t.label === thisDeviceLabel),
    [thisDeviceTokenId, thisDeviceLabel],
  );

  const load = useCallback(async () => {
    try {
      setError(null);
      const [list, ownId] = await Promise.all([listTokens(), storedPatTokenId()]);
      setThisDeviceTokenId(ownId);
      setTokens(list);
    } catch {
      setError("Couldn't load your connected devices.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRevoke = (t: ShortcutToken) => {
    const isThisDevice = isThisDeviceToken(t);
    Alert.alert(
      "Remove this device?",
      isThisDevice
        ? "Sharing to Clipnote from this device will stop working until you reopen the app."
        : "This device will no longer be able to save to Clipnote.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setRevoking(t.id);
            try {
              await revokeToken(t.id);
              // Revoking our own token: clear the stale Keychain copy so foreground re-mints.
              if (isThisDevice) await clearSharedPat();
              await load();
            } catch {
              setError("Couldn't remove that device.");
            } finally {
              setRevoking(null);
            }
          },
        },
      ],
    );
  };

  return (
    <View>
      <Text className="mb-2 mt-6 px-1 text-xs uppercase tracking-wider text-ink-soft">
        Connected devices
      </Text>

      {tokens === null && !error ? (
        <View className="items-center rounded-2xl border border-border bg-card py-6">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <Pressable
          onPress={load}
          accessibilityRole="button"
          className="rounded-2xl border border-border bg-card p-4 active:opacity-80"
        >
          <Text className="text-sm text-ink-soft">{error} Tap to retry.</Text>
        </Pressable>
      ) : tokens && tokens.length === 0 ? (
        <View className="rounded-2xl border border-border bg-card p-4">
          <Text className="text-sm text-ink-soft">
            No connected devices yet. Sharing a link to Clipnote connects this device
            automatically.
          </Text>
        </View>
      ) : (
        <View className="overflow-hidden rounded-2xl border border-border bg-card">
          {tokens?.map((t, i) => {
            const isThisDevice = isThisDeviceToken(t);
            const created = fmtDate(t.created_at);
            const lastUsed = fmtDate(t.last_used_at);
            const meta = lastUsed
              ? `Last used ${lastUsed}`
              : created
                ? `Added ${created}`
                : isAppPatLabel(t.label)
                  ? "This app"
                  : "iOS Shortcut";
            return (
              <View
                key={t.id}
                className={`flex-row items-center gap-3 p-4 ${i > 0 ? "border-t border-border" : ""}`}
              >
                <Smartphone size={20} className="text-ink-soft" />
                <View className="min-w-0 flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="text-sm font-medium text-ink" numberOfLines={1}>
                      {t.label || "Device"}
                    </Text>
                    {isThisDevice ? (
                      <View className="rounded-full bg-ink px-2 py-0.5">
                        <Text className="text-[10px] font-semibold uppercase text-paper">
                          This device
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text className="text-xs text-ink-soft" numberOfLines={1}>
                    {meta}
                  </Text>
                </View>
                {revoking === t.id ? (
                  <ActivityIndicator />
                ) : (
                  <Pressable
                    onPress={() => onRevoke(t)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${t.label || "device"}`}
                    hitSlop={8}
                    className="active:opacity-70"
                  >
                    <Trash2 size={18} className="text-destructive" />
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
