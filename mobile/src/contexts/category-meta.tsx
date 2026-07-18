import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { doc, getFirestore, onSnapshot } from "@react-native-firebase/firestore";
import { setCategoryOverrides, type CategoryMeta } from "@clipnote/shared";
import { useAuth } from "@/contexts/auth-context";

// Loads the user's per-category icon/colour choices (users/{uid}.category_meta) and pushes
// them into note-meta's module-level override registry, so noteAccent/noteIcon reflect them
// everywhere — including screens rendered before Settings is ever opened. Port of
// frontend/src/contexts/category-meta.tsx onto the RNFirebase modular API. The `version`
// counter exists because pure functions like noteIcon can't subscribe to the registry:
// screens that render categories may read `version` to re-render when a choice lands.
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
      doc(getFirestore(), "users", user.uid),
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
export const useCategoryMeta = () => useContext(CategoryMetaContext).version;
