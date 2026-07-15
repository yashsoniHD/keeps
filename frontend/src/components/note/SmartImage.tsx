import type { ReactNode } from "react";
import { useImageAspect, orientationOf } from "./useImageAspect";

// The single image primitive for note surfaces. The caller picks the frame (a fixed
// aspect/height plus rounding/border, via `frameClass`); SmartImage fills it based on the
// image's own orientation, measured off-screen first so the layout never flashes:
//   - landscape → crops cleanly edge-to-edge (object-cover fill);
//   - portrait / square → shown sharp and whole (object-contain) centered over a blurred,
//     dimmed copy of itself, so a tall collage or poster never sits in an empty box or gets
//     brutally cropped.
// Loading shows a neutral bg-card placeholder at the same frame (no reflow); `none` (no url or
// a broken image) renders the caller's `fallback`. Never an accent-wash box around an image.
export function SmartImage({
  src,
  alt = "",
  frameClass,
  fallback,
  loading = "lazy",
}: {
  src?: string | null;
  alt?: string;
  frameClass: string;
  fallback?: ReactNode;
  loading?: "lazy" | "eager";
}) {
  const { status, ratio } = useImageAspect(src);

  if (!src || status === "none") {
    return fallback ? <>{fallback}</> : null;
  }

  // Hold the space at the final frame while measuring, so the choice doesn't flash.
  if (status === "loading") {
    return <div className={`${frameClass} bg-card`} />;
  }

  if (orientationOf(ratio) === "landscape") {
    return (
      <div className={`relative overflow-hidden ${frameClass}`}>
        <img
          src={src}
          alt={alt}
          loading={loading}
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>
    );
  }

  // Portrait / square: sharp image whole over a blurred, dimmed copy of itself.
  return (
    <div className={`relative overflow-hidden ${frameClass}`}>
      <img
        src={src}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-70 blur-xl"
      />
      <div className="absolute inset-0 bg-ink/5 dark:bg-black/25" />
      <img
        src={src}
        alt={alt}
        loading={loading}
        className="absolute inset-0 h-full w-full object-contain"
      />
    </div>
  );
}
