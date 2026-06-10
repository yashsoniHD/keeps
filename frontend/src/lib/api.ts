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
