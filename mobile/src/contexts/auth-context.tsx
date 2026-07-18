import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import {
  getAuth,
  onAuthStateChanged,
  signInWithCredential,
  updateProfile,
  GoogleAuthProvider,
  AppleAuthProvider,
  signOut as firebaseSignOut,
  type User,
} from "@react-native-firebase/auth";
import {
  GoogleSignin,
  statusCodes,
  isSuccessResponse,
  isErrorWithCode,
} from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";

import { clearSharedPat, syncSharedPat } from "@/lib/shared-credentials";

// Configure the native Google Sign-In SDK once, at module load. `webClientId` is the OAuth
// client Firebase verifies the ID token against; `iosClientId` is the native iOS client.
GoogleSignin.configure({
  webClientId: "674775099277-1ehl9gksjm8m94na95p77lu5020h6nt6.apps.googleusercontent.com",
  iosClientId: "674775099277-qkb491uc3bbpuhhogn8aega9l56buneh.apps.googleusercontent.com",
});

// Mirrors frontend/src/contexts/auth-context.tsx so ported components keep working — plus
// signInWithApple (native-only, required for App Store review alongside Google).
interface AuthCtx {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  signInWithGoogle: async () => {},
  signInWithApple: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getAuth(), (u) => {
      setUser(u);
      setLoading(false);
      // Mint + park the share-extension PAT right after sign-in (no-op if already stored).
      if (u) void syncSharedPat();
    });
    // Re-check on every foreground so a missing Keychain entry (fresh restore, manual revoke)
    // is re-minted; syncSharedPat is a no-op when the token is still there.
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active" && getAuth().currentUser) void syncSharedPat();
    });
    return () => {
      unsubscribe();
      appState.remove();
    };
  }, []);

  const signInWithGoogle = async () => {
    try {
      // Android-only guard (resolves to true everywhere else) — safe to always await.
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();
      // v16 returns a discriminated union: { type: "success", data: User } | { type: "cancelled" }.
      if (!isSuccessResponse(response)) return; // user dismissed the picker — no-op
      const idToken = response.data.idToken;
      if (!idToken) throw new Error("Google sign-in did not return an ID token.");
      await signInWithCredential(getAuth(), GoogleAuthProvider.credential(idToken));
    } catch (err) {
      // A cancel can also surface as a thrown native error on some flows — swallow it.
      if (isErrorWithCode(err) && err.code === statusCodes.SIGN_IN_CANCELLED) return;
      throw err;
    }
  };

  const signInWithApple = async () => {
    if (!(await AppleAuthentication.isAvailableAsync())) {
      throw new Error("Sign in with Apple is not available on this device.");
    }
    // Firebase verifies the raw nonce against the SHA-256 hash we hand to Apple — this is
    // the replay-attack guard Firebase requires for the Apple OAuth credential.
    const rawNonce = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce,
    );
    try {
      const appleCredential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
      const { identityToken, fullName } = appleCredential;
      if (!identityToken) throw new Error("Apple sign-in did not return an identity token.");
      const cred = AppleAuthProvider.credential(identityToken, rawNonce);
      const { user: signedInUser } = await signInWithCredential(getAuth(), cred);
      // Apple only returns the name on the FIRST authorization. Persist it once so the
      // account isn't nameless (Apple's App Store review checks for this).
      const displayName = [fullName?.givenName, fullName?.familyName]
        .filter(Boolean)
        .join(" ")
        .trim();
      if (displayName && !signedInUser.displayName) {
        await updateProfile(signedInUser, { displayName });
      }
    } catch (err) {
      // expo-apple-authentication rejects with this code when the user cancels — swallow it.
      if ((err as { code?: string })?.code === "ERR_REQUEST_CANCELED") return;
      throw err;
    }
  };

  const signOut = async () => {
    // Revoke + drop the shared PAT while the Firebase session is still valid, then sign out.
    await clearSharedPat();
    await firebaseSignOut(getAuth());
  };

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signInWithApple, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
