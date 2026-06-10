import { getAuthHeader } from "@/integrations/firebase/auth-middleware";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

export async function ingest(url: string): Promise<{ job_id: string; status: string }> {
  const headers = await getAuthHeader();
  const res = await fetch(`${API_URL}/api/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}) as { detail?: string });
    throw new Error(err.detail ?? "Couldn't start the capture. Please try again.");
  }
  return res.json();
}

export async function deleteAllNotes(): Promise<void> {
  const headers = await getAuthHeader();
  const res = await fetch(`${API_URL}/api/notes`, { method: "DELETE", headers });
  if (!res.ok) throw new Error("Couldn't clear notes.");
}

// --- Personal Access Tokens (iOS shortcut) ---

export interface ShortcutToken {
  id: string;
  label: string;
  created_at?: string;
  last_used_at?: string | null;
}

export async function createToken(label: string): Promise<{ token: string; id: string }> {
  const headers = await getAuthHeader();
  const res = await fetch(`${API_URL}/api/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ label }),
  });
  if (!res.ok) throw new Error("Couldn't create token.");
  return res.json();
}

export async function listTokens(): Promise<ShortcutToken[]> {
  const headers = await getAuthHeader();
  const res = await fetch(`${API_URL}/api/tokens`, { headers });
  if (!res.ok) throw new Error("Couldn't load tokens.");
  return res.json();
}

export async function revokeToken(id: string): Promise<void> {
  const headers = await getAuthHeader();
  const res = await fetch(`${API_URL}/api/tokens/${id}`, { method: "DELETE", headers });
  if (!res.ok) throw new Error("Couldn't revoke token.");
}

export const API_BASE = API_URL;
