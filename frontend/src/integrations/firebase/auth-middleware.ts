import { auth } from "./client";

export async function getAuthHeader(forceRefresh = false): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) return {};
  // getIdToken() returns the cached token even when it's expired (e.g. the tab sat
  // in the background past the 1h expiry) — forceRefresh mints a fresh one.
  const token = await user.getIdToken(forceRefresh);
  return { Authorization: `Bearer ${token}` };
}
