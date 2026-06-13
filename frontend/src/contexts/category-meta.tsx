import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { setCategoryOverrides, type CategoryMeta } from "@/lib/note-meta";
import { useAuth } from "@/contexts/auth-context";

// Loads the user's per-category icon/colour choices (users/{uid}.category_meta) and pushes
// them into note-meta's module-level override registry, so noteAccent/noteIcon reflect them
// everywhere. The `version` counter is what makes it propagate: pure functions like noteIcon
// can't subscribe to the registry, so the container routes that render categories read
// `version` here — when overrides change, version bumps, those routes re-render, and their
// cards/badges re-run noteIcon/noteAccent against the freshly-updated registry.
const CategoryMetaContext = createContext<{ version: number }>({ version: 0 });

export function CategoryMetaProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!user) {
      setCategoryOverrides({});
      setVersion((v) => v + 1);
      return;
    }
    return onSnapshot(
      doc(db, "users", user.uid),
      (snap) => {
        const meta = (snap.data()?.category_meta ?? {}) as Record<string, CategoryMeta>;
        setCategoryOverrides(meta);
        setVersion((v) => v + 1);
      },
      () => {}, // a denied/offline read just leaves the auto-derived defaults in place
    );
  }, [user]);

  return (
    <CategoryMetaContext.Provider value={{ version }}>{children}</CategoryMetaContext.Provider>
  );
}

// Subscribe a component to override changes. The returned version is otherwise unused — its
// purpose is to re-render the caller (and its subtree) when a user's icon/colour choice lands.
// eslint-disable-next-line react-refresh/only-export-components
export const useCategoryMeta = () => useContext(CategoryMetaContext).version;
