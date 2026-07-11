// Browser errors are invisible to ops otherwise — ship them to the backend sink
// (logged at ERROR severity in Cloud Logging). Deduped per session, hard-capped.
const reportedErrors = new Set<string>();

export function reportClientError(kind: string, message: unknown, stack?: unknown) {
  const msg = String(message ?? "unknown").slice(0, 500);
  const key = `${kind}:${msg}`;
  if (reportedErrors.has(key) || reportedErrors.size >= 10) return;
  reportedErrors.add(key);
  const body = JSON.stringify({
    kind,
    message: msg,
    stack: String(stack ?? "").slice(0, 1000),
    path: window.location.pathname,
    ua: navigator.userAgent.slice(0, 200),
  });
  const base =
    import.meta.env.VITE_API_URL ??
    (import.meta.env.DEV
      ? "http://localhost:8080"
      : "https://clip-note-api-674775099277.us-central1.run.app");
  const endpoint = `${base}/api/client-errors`;
  try {
    if (!navigator.sendBeacon?.(endpoint, body)) {
      fetch(endpoint, { method: "POST", body, keepalive: true }).catch(() => {});
    }
  } catch {
    /* reporting must never throw */
  }
}
