import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  type User,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  getAdditionalUserInfo,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { clearIndexedDbPersistence, terminate } from "firebase/firestore";
import { auth, db } from "@/integrations/firebase/client";
import { analytics } from "@/lib/analytics";
import { ensureUserRegion, recordSignup } from "@/lib/firestore";
import { readSignupRef, clearSignupRef } from "@/lib/attribution";
import { clearCache } from "@/lib/swr-cache";
import { clearNotes } from "@/keeps/noteCache";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  signInWithGoogle: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let uid: string | null = null;
    return onAuthStateChanged(auth, (u) => {
      if ((u?.uid ?? null) !== uid) clearNotes(); // never carry one account's notes to another
      uid = u?.uid ?? null;
      setUser(u);
      setLoading(false);
      // Seed the "where to watch" region (TMDB providers on notes) once, the first time we see this user.
      if (u) ensureUserRegion(u.uid).catch(() => {});
      // Sign-out: wipe the SWR cache so a next user never sees the previous account's feed/walls.
      else clearCache();
    });
  }, []);

  const signInWithGoogle = async () => {
    const cred = await signInWithPopup(auth, new GoogleAuthProvider());
    try {
      if (getAdditionalUserInfo(cred)?.isNewUser) {
        const ref = readSignupRef();
        analytics.signUp("google", ref ?? undefined);
        // Persist the acquisition source for the dashboard's signup-source breakdown.
        recordSignup(cred.user.uid, ref).catch(() => {});
        clearSignupRef();
      }
    } catch {
      /* analytics/attribution are non-critical — never let them break sign-in */
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    // Wipe the persistent Firestore cache so the next person on a shared device can't read
    // this user's notes from IndexedDB. `terminate` makes `db` unusable, so reload to get a
    // fresh instance.
    try {
      await terminate(db);
      await clearIndexedDbPersistence(db);
    } catch {
      /* another tab may still hold the cache; best-effort */
    }
    window.location.assign("/login");
  };

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
