import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { ChatMessage } from "@/lib/api";

// Drives the global Clip-AI FAB + docked chat overlay (see components/ask/AskFab.tsx).
// State lives here, above the router <Outlet />, so the panel persists across navigation
// and any screen can open it. The note-detail page registers a focal note so a chat opened
// from a note is scoped "this note first, then all" (backend note_id).
//
// TWO contexts, deliberately: the UI context (open/seed/focal) changes rarely, while the
// chat session (messages) changes on every streamed token. Splitting them means the feed —
// which stays mounted under the overlay and only needs `openChat` — does NOT re-render on
// every token. Only AskChat subscribes to the session via useChatSession().
type ScopeNote = { id: string; title: string };

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

// The active conversation, owned above AskChat so it outlives the chat panel closing. It
// resets only on an explicit "New chat" (resetChat) or a full page refresh — this is
// in-memory and intentionally NOT persisted to storage.
interface ChatSessionCtx {
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  conversationId: string | null;
  setConversationId: Dispatch<SetStateAction<string | null>>;
  selectedScope: ScopeNote[];
  setSelectedScope: Dispatch<SetStateAction<ScopeNote[]>>;
  resetChat: () => void;
}

const AskContext = createContext<AskCtx | null>(null);
const ChatSessionContext = createContext<ChatSessionCtx | null>(null);

export function AskProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  const [focal, setFocal] = useState<{ id: string; title: string } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [selectedScope, setSelectedScope] = useState<ScopeNote[]>([]);

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
  const resetChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setSelectedScope([]);
  }, []);

  const askValue = useMemo<AskCtx>(
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

  const sessionValue = useMemo<ChatSessionCtx>(
    () => ({
      messages,
      setMessages,
      conversationId,
      setConversationId,
      selectedScope,
      setSelectedScope,
      resetChat,
    }),
    [messages, conversationId, selectedScope, resetChat],
  );

  return (
    <AskContext.Provider value={askValue}>
      <ChatSessionContext.Provider value={sessionValue}>{children}</ChatSessionContext.Provider>
    </AskContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAsk(): AskCtx {
  const ctx = useContext(AskContext);
  if (!ctx) throw new Error("useAsk must be used within <AskProvider>");
  return ctx;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useChatSession(): ChatSessionCtx {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) throw new Error("useChatSession must be used within <AskProvider>");
  return ctx;
}
