import { getAuth } from "@react-native-firebase/auth";

// Mirrors the web version (frontend/src/integrations/firebase/auth-middleware.ts): returns the
// Bearer header for the signed-in user, or {} when signed out. getIdToken() serves the cached
// token even when it's expired (e.g. the app sat backgrounded past the 1h expiry); `force` mints
// a fresh one — api.ts's 401-retry path relies on that.
export async function getAuthHeader(force = false): Promise<Record<string, string>> {
  const user = getAuth().currentUser;
  if (!user) return {};
  const token = await user.getIdToken(force);
  return { Authorization: `Bearer ${token}` };
}
