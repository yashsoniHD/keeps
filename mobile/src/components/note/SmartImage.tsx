import { useState, type ReactNode } from "react";
import { View, StyleSheet } from "react-native";
import { Image, type ImageLoadEventData } from "expo-image";

// The single image primitive for note surfaces. Port of
// frontend/src/components/note/SmartImage.tsx — measures the image's orientation off its first
// load, then fills the frame accordingly:
//   - landscape → crops cleanly edge-to-edge (cover fill), fixed 16:9-ish banner height;
//   - portrait / square → shown whole (contain) centered over a blurred, dimmed copy of itself
//     in a 16:9 box, so a tall poster never sits in an empty box or gets brutally cropped.
// No url or a broken image renders the caller's `fallback`.
export function SmartImage({
  uri,
  fallback,
  rounded = true,
}: {
  uri?: string | null;
  fallback?: ReactNode;
  rounded?: boolean;
}) {
  const [ratio, setRatio] = useState<number | null>(null);
  const [errored, setErrored] = useState(false);

  if (!uri || errored) return <>{fallback ?? null}</>;

  const frame = `w-full overflow-hidden ${rounded ? "rounded-3xl border border-border" : ""}`;
  const onLoad = (e: ImageLoadEventData) => {
    const { width, height } = e.source;
    if (width && height) setRatio(width / height);
  };

  // Landscape (also the pre-measure state): a cover-filled banner. Measuring happens on this
  // same image's onLoad, so a real cover paints immediately instead of flashing a placeholder.
  if (ratio === null || ratio >= 1.3) {
    return (
      <View className={`${frame} h-56`}>
        <Image
          source={{ uri }}
          style={{ flex: 1 }}
          contentFit="cover"
          onLoad={onLoad}
          onError={() => setErrored(true)}
        />
      </View>
    );
  }

  // Portrait / square: sharp whole image over a blurred, dimmed copy of itself.
  return (
    <View className={`${frame} aspect-[16/9]`}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.08)" }]} />
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
    </View>
  );
}
