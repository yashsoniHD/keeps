import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  type User,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  getAdditionalUserInfo,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { auth } from "@/integrations/firebase/client";
import { analytics } from "@/lib/analytics";
import { recordSignup } from "@/lib/firestore";
import { readSignupRef, clearSignupRef } from "@/lib/attribution";

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
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
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
  };

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
