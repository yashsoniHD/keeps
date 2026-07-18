import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Trash2, X } from "lucide-react-native";

import { useAuth } from "@/contexts/auth-context";
import { deleteAccount } from "@/lib/api";
import { interopIcon } from "@/lib/note-meta";
import { useTheme } from "@/theme/ThemeProvider";
import { dark, light } from "@/theme/tokens";

// className styling on SVG icons requires interop registration (see note-meta / settings).
[Trash2, X].forEach(interopIcon);

// The confirmation word the user must type to arm the delete (App Store Guideline 5.1.1(v)
// wants an unmistakable, deliberate action).
const CONFIRM_WORD = "DELETE";

// Danger zone: permanently delete the account + all data. Two-step — a destructive row opens a
// confirmation sheet that stays disabled until the user types DELETE, then calls the backend and
// signs out. The Firebase user is gone server-side by then, so the local sign-out may partially
// fail; we swallow that and land on /sign-in regardless so the session is never left half-alive.
export function DeleteAccount() {
  const { signOut } = useAuth();
  const router = useRouter();
  const { resolved } = useTheme();
  const t = resolved === "dark" ? dark : light;

  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const armed = confirm.trim() === CONFIRM_WORD;

  const close = () => {
    if (busy) return;
    setOpen(false);
    setConfirm("");
    setError(null);
  };

  const handleDelete = async () => {
    if (!armed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
    } catch {
      setError("Couldn't delete your account. Please try again.");
      setBusy(false);
      return;
    }
    // Account is gone server-side. Clear the local session no matter what the sign-out does
    // (the Firebase user no longer exists, so firebaseSignOut may reject) and route to sign-in.
    try {
      await signOut();
    } catch {
      // Local session teardown is best-effort here — the account is already deleted.
    }
    router.replace("/sign-in");
  };

  return (
    <View>
      <Text className="mb-2 mt-8 px-1 text-xs uppercase tracking-wider text-ink-soft">
        Danger zone
      </Text>

      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        className="flex-row items-center gap-3 rounded-2xl border border-destructive/40 bg-card p-4 active:opacity-80"
      >
        <Trash2 size={18} className="text-destructive" />
        <View className="min-w-0 flex-1">
          <Text className="text-base font-medium text-destructive">Delete account</Text>
          <Text className="text-sm text-ink-soft">
            Permanently delete your account and all your data.
          </Text>
        </View>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <View className="flex-1 justify-end bg-ink/40">
          <Pressable className="absolute inset-0" onPress={close} accessibilityLabel="Close" />
          <View className="rounded-t-3xl border border-border bg-card p-5">
            <View className="flex-row items-center justify-between">
              <Text className="font-serif text-2xl text-ink">Delete account</Text>
              <Pressable
                onPress={close}
                accessibilityLabel="Close"
                className="h-8 w-8 items-center justify-center rounded-full"
              >
                <X size={16} className="text-ink-soft" />
              </Pressable>
            </View>

            <Text className="mt-2 text-sm text-ink-soft">
              This permanently deletes your account and every note, collection, and file you have
              saved. This cannot be undone.
            </Text>

            <Text className="mt-4 text-xs uppercase tracking-wider text-ink-soft">
              Type {CONFIRM_WORD} to confirm
            </Text>
            <TextInput
              value={confirm}
              onChangeText={setConfirm}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder={CONFIRM_WORD}
              placeholderTextColor={t["ink-soft"]}
              editable={!busy}
              className="mt-2 rounded-2xl border border-border bg-paper px-4 py-3 text-base text-ink"
            />

            {error ? <Text className="mt-3 text-sm text-destructive">{error}</Text> : null}

            <Pressable
              onPress={handleDelete}
              disabled={!armed || busy}
              className={`mt-4 flex-row items-center justify-center gap-2 rounded-full py-3.5 ${
                !armed || busy ? "bg-muted" : "bg-destructive"
              }`}
            >
              {busy ? (
                <ActivityIndicator size="small" color={t.paper} />
              ) : (
                <Trash2 size={18} className={armed ? "text-destructive-foreground" : "text-ink-soft"} />
              )}
              <Text
                className={`text-base font-medium ${
                  armed && !busy ? "text-destructive-foreground" : "text-ink-soft"
                }`}
              >
                {busy ? "Deleting…" : "Delete my account"}
              </Text>
            </Pressable>

            <Pressable
              onPress={close}
              disabled={busy}
              className="mt-2 items-center justify-center py-3"
            >
              <Text className="text-base font-medium text-ink-soft">Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
