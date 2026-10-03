// Category merge lives in its own module because api.ts is owned elsewhere. It mirrors
// api.ts's fetch contract exactly: same env-aware API base, same forced-token-refresh retry
// on a 401, same ApiError surface — so callers can treat it like any other api.ts helper.
import { getAuthHeader } from "@/integrations/firebase/auth-middleware";
import { ApiError } from "@/lib/api";

// Must stay in lockstep with api.ts: a production build must NEVER fall back to localhost.
const API_URL =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV
    ? "http://localhost:8080"
    : "https://clip-note-api-yashsoni102-progs-projects.vercel.app");

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const attempt = async (forceRefresh: boolean) => {
    const headers = await getAuthHeader(forceRefresh);
    return fetch(`${API_URL}${path}`, { ...init, headers: { ...init.headers, ...headers } });
  };
  let res = await attempt(false);
  if (res.status === 401) res = await attempt(true);
  return res;
}

// Fold one category into another: every note tagged `slug` moves to `into`, and `slug` is
// dropped from the taxonomy. Non-destructive (notes survive), server-side, idempotent (a
// slug that's already gone 404s). Returns the resolved target and how many notes moved.
export async function mergeCategory(
  slug: string,
  into: string,
): Promise<{ merged_into: string; count: number }> {
  const res = await apiFetch(`/api/categories/${encodeURIComponent(slug)}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ into }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}) as { detail?: string });
    const detail =
      typeof err.detail === "string" ? err.detail : "Couldn't merge the category.";
    throw new ApiError(detail, res.status);
  }
  return res.json();
}
