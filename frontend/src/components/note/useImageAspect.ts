import { useEffect, useState } from "react";

// Measures an image's natural aspect ratio off-screen so a template can pick a layout
// (wide banner vs. contained portrait poster) before the image paints, avoiding a
// crop-then-reflow flash. `ratio` is width / height. Shared by the cover hero
// (NoteContent) and the venue photo (PlaceNote) so both treat portrait images the same.
export type AspectStatus = "loading" | "none" | "loaded";

export interface ImageAspect {
  status: AspectStatus;
  ratio: number; // width / height (1 while loading / when absent)
}

export function useImageAspect(url?: string | null): ImageAspect {
  const [state, setState] = useState<ImageAspect>(
    url ? { status: "loading", ratio: 1 } : { status: "none", ratio: 1 },
  );
  useEffect(() => {
    if (!url) {
      setState({ status: "none", ratio: 1 });
      return;
    }
    setState({ status: "loading", ratio: 1 });
    let live = true;
    const img = new Image();
    img.onload = () => {
      if (!live) return;
      const ratio = img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1;
      setState({ status: "loaded", ratio });
    };
    img.onerror = () => live && setState({ status: "none", ratio: 1 });
    img.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  return state;
}

// A measured ratio → a coarse orientation bucket the templates lay out against.
// Landscape crops cleanly into a banner; portrait wants a contained poster.
export type Orientation = "landscape" | "portrait" | "square";

export function orientationOf(ratio: number): Orientation {
  if (ratio >= 1.15) return "landscape";
  if (ratio <= 0.85) return "portrait";
  return "square";
}
