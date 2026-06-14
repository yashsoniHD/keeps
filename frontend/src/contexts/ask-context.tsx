import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

// Drives the global Ask-AI FAB + docked chat overlay (see components/ask/AskFab.tsx).
// State lives here, above the router <Outlet />, so the panel persists across navigation
// and any screen can open it. The note-detail page registers a focal note so a chat opened
// from a note is scoped "this note first, then all" (backend note_id).
interface AskCtx {
  isOpen: boolean;
  // A query that should pre-fill + auto-send when the panel opens (feed search → Ask hand-off).
  seed: string | null;
  openChat: (prefill?: string) => void;
  closeChat: () => void;
  toggleChat: () => void;
  clearSeed: () => void;
  focalNoteId: string | null;
  focalNoteTitle: string | null;
  setFocalNote: (note: { id: string; title: string } | null) => void;
}

const AskContext = createContext<AskCtx | null>(null);

export function AskProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  const [focal, setFocal] = useState<{ id: string; title: string } | null>(null);

  const openChat = useCallback((prefill?: string) => {
    setSeed(prefill && prefill.trim() ? prefill.trim() : null);
    setIsOpen(true);
  }, []);
  const closeChat = useCallback(() => setIsOpen(false), []);
  const toggleChat = useCallback(() => setIsOpen((o) => !o), []);
  const clearSeed = useCallback(() => setSeed(null), []);
  const setFocalNote = useCallback((note: { id: string; title: string } | null) => {
    setFocal(note);
  }, []);

  const value = useMemo<AskCtx>(
    () => ({
      isOpen,
      seed,
      openChat,
      closeChat,
      toggleChat,
      clearSeed,
      focalNoteId: focal?.id ?? null,
      focalNoteTitle: focal?.title ?? null,
      setFocalNote,
    }),
    [isOpen, seed, openChat, closeChat, toggleChat, clearSeed, focal, setFocalNote],
  );

  return <AskContext.Provider value={value}>{children}</AskContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAsk(): AskCtx {
  const ctx = useContext(AskContext);
  if (!ctx) throw new Error("useAsk must be used within <AskProvider>");
  return ctx;
}
