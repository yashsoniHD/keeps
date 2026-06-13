import { useState } from "react";
import { Link2, ArrowRight } from "lucide-react";
import { CaptureModal } from "./CaptureModal";

export function PasteLinkBar({ variant = "default" }: { variant?: "default" | "compact" }) {
  const [url, setUrl] = useState("");
  const [capturing, setCapturing] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setCapturing(url.trim());
    setUrl("");
  }

  const big = variant === "default";

  return (
    <>
      <form
        onSubmit={submit}
        className={`flex w-full items-center gap-2 rounded-full border border-border bg-card pl-4 pr-1.5 transition-shadow focus-within:shadow-md ${
          big ? "py-1.5" : "py-1"
        }`}
      >
        <Link2 className={`shrink-0 text-ink-soft ${big ? "h-5 w-5" : "h-4 w-4"}`} />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste any link: article, reel, recipe, product…"
          className={`flex-1 bg-transparent outline-none placeholder:text-ink-soft ${
            big ? "py-2.5 text-base" : "py-1.5 text-sm"
          }`}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50 ${
            big ? "px-4 py-2.5 text-sm" : "px-3 py-1.5 text-xs"
          }`}
          disabled={!url.trim()}
        >
          Capture
          <ArrowRight className={big ? "h-4 w-4" : "h-3.5 w-3.5"} />
        </button>
      </form>

      {capturing && <CaptureModal url={capturing} onClose={() => setCapturing(null)} />}
    </>
  );
}
