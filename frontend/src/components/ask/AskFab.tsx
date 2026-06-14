import { useRouterState } from "@tanstack/react-router";
import { WandSparkles, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useAsk } from "@/contexts/ask-context";
import { AskChat } from "./AskChat";

// Routes where the Ask-AI FAB has no place: signed-out / public viewer surfaces.
const HIDDEN_PREFIXES = ["/login", "/share", "/p/"];

// Global floating Ask-AI button + docked chat overlay. Mounted once in __root.tsx (inside
// the provider tree) so it persists across navigation. The button stays put and toggles
// the panel open/closed; on a note's page the chat is scoped to that note via ask-context.
export function AskFab() {
  const { user } = useAuth();
  const { isOpen, toggleChat, closeChat, seed, clearSeed, focalNoteId, focalNoteTitle } = useAsk();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const hidden = !user || HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
  if (hidden) return null;

  return (
    <>
      {isOpen && (
        <div
          data-no-refresh
          role="dialog"
          aria-label="Ask AI"
          className="fixed inset-0 z-50 flex flex-col border-border bg-background sm:inset-auto sm:bottom-24 sm:right-5 sm:h-[600px] sm:max-h-[80dvh] sm:w-[400px] sm:max-w-[calc(100vw-2.5rem)] sm:rounded-3xl sm:border sm:shadow-2xl"
        >
          <AskChat
            noteId={focalNoteId}
            noteTitle={focalNoteTitle}
            seed={seed}
            onSeedConsumed={clearSeed}
            onClose={closeChat}
          />
        </div>
      )}

      <button
        type="button"
        onClick={toggleChat}
        aria-label={isOpen ? "Close Ask AI" : "Ask AI"}
        title={isOpen ? "Close Ask AI" : "Ask AI"}
        className="fixed bottom-8 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-paper shadow-xl transition-transform active:scale-95"
      >
        {isOpen ? <X className="h-6 w-6" /> : <WandSparkles className="h-6 w-6" />}
      </button>
    </>
  );
}
