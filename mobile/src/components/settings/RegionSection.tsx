import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Check, ChevronRight, Globe, X } from "lucide-react-native";

import { useAuth } from "@/contexts/auth-context";
import { getUserRegion, setUserRegion } from "@/lib/firestore";
import { interopIcon } from "@/lib/note-meta";

// className styling on SVG icons requires interop registration (see note-meta / settings).
[Check, ChevronRight, Globe, X].forEach(interopIcon);

// The regions Clipnote's enrichment supports for streaming providers (TMDB/JustWatch) and
// place action links (Google Places). Curated to major markets rather than every ISO code —
// codes are ISO-3166-1 alpha-2, which is what the backend stores + queries against.
const REGIONS: { code: string; name: string }[] = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "IN", name: "India" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "IE", name: "Ireland" },
  { code: "NZ", name: "New Zealand" },
  { code: "SG", name: "Singapore" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "PT", name: "Portugal" },
  { code: "NL", name: "Netherlands" },
  { code: "BE", name: "Belgium" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" },
  { code: "FI", name: "Finland" },
  { code: "CH", name: "Switzerland" },
  { code: "AT", name: "Austria" },
  { code: "PL", name: "Poland" },
  { code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },
  { code: "AR", name: "Argentina" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "HK", name: "Hong Kong" },
  { code: "MY", name: "Malaysia" },
  { code: "ID", name: "Indonesia" },
  { code: "PH", name: "Philippines" },
  { code: "TH", name: "Thailand" },
  { code: "ZA", name: "South Africa" },
  { code: "SA", name: "Saudi Arabia" },
];

const REGION_NAME = new Map(REGIONS.map((r) => [r.code, r.name]));

// Best-effort country guess from the device locale — mirrors firestore.ts guessRegion
// (RN has no navigator, so read Intl's resolved locale, e.g. "en-IN" → "IN"). Returns "".
function guessDeviceRegion(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || "";
    const m = locale.match(/[-_]([A-Za-z]{2})\b/);
    return m ? m[1].toUpperCase() : "";
  } catch {
    return "";
  }
}

// Region picker: sets users/{uid}.region, which feeds streaming providers ("where to watch")
// and region-aware action links (Directions / Reserve / Order) on enriched notes. On first
// open with no region set, the device-locale guess is offered as the suggested pick.
export function RegionSection() {
  const { user } = useAuth();
  const [region, setRegion] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guess = guessDeviceRegion();

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setError(null);
      const current = await getUserRegion(user.uid);
      // Unset → suggest the device-locale guess (only persisted once the user confirms a pick).
      setRegion(current || null);
    } catch {
      setError("Couldn't load your region.");
    } finally {
      setLoaded(true);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const pick = async (code: string) => {
    if (!user) return;
    setSaving(code);
    setError(null);
    try {
      await setUserRegion(user.uid, code);
      setRegion(code);
      setOpen(false);
    } catch {
      setError("Couldn't save your region. Please try again.");
    } finally {
      setSaving(null);
    }
  };

  // What the row shows: the saved region, else the guess as a suggestion, else a prompt.
  const effective = region ?? (guess || null);
  const rowValue = !loaded
    ? "…"
    : region
      ? REGION_NAME.get(region) ?? region
      : guess
        ? `${REGION_NAME.get(guess) ?? guess} (suggested)`
        : "Not set";

  return (
    <View>
      <Text className="mb-2 mt-6 px-1 text-xs uppercase tracking-wider text-ink-soft">Region</Text>

      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        className="flex-row items-center gap-3 rounded-2xl border border-border bg-card p-4 active:opacity-80"
      >
        <View className="h-10 w-10 items-center justify-center rounded-full bg-trip-soft">
          <Globe size={18} className="text-trip-chip" />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-base font-medium text-ink">Region</Text>
          <Text className="text-sm text-ink-soft" numberOfLines={1}>
            {rowValue}
          </Text>
        </View>
        <ChevronRight size={20} className="text-ink-soft" />
      </Pressable>

      <Text className="mt-2 px-1 text-xs text-ink-soft">
        Sets the streaming providers and action links shown on your notes.
      </Text>

      {error ? <Text className="mt-2 px-1 text-sm text-destructive">{error}</Text> : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View className="flex-1 justify-end bg-ink/30">
          <Pressable
            className="absolute inset-0"
            onPress={() => setOpen(false)}
            accessibilityLabel="Close"
          />
          <View className="max-h-[80%] rounded-t-3xl border border-border bg-card">
            <View className="flex-row items-center justify-between px-5 pb-2 pt-5">
              <Text className="font-serif text-2xl text-ink">Choose your region</Text>
              <Pressable
                onPress={() => setOpen(false)}
                accessibilityLabel="Close"
                className="h-8 w-8 items-center justify-center rounded-full"
              >
                <X size={16} className="text-ink-soft" />
              </Pressable>
            </View>
            <ScrollView className="px-3 pb-6" contentContainerClassName="pb-4">
              {REGIONS.map((r) => {
                const active = effective === r.code;
                return (
                  <Pressable
                    key={r.code}
                    onPress={() => pick(r.code)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    className="flex-row items-center gap-3 rounded-xl px-3 py-3 active:opacity-70"
                  >
                    <Text className="w-8 text-sm font-medium text-ink-soft">{r.code}</Text>
                    <Text className="min-w-0 flex-1 text-base text-ink">{r.name}</Text>
                    {saving === r.code ? (
                      <ActivityIndicator size="small" />
                    ) : active ? (
                      <Check size={18} className="text-trip-chip" />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
