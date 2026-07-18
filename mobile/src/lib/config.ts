// API base URL.
//
// The web app (frontend/src/lib/api.ts) resolves this from `import.meta.env.VITE_API_URL`,
// falling back to localhost in dev and the live Cloud Run API in prod. Expo has no
// `import.meta.env`; mirror the intent with an `EXPO_PUBLIC_API_URL` override (inlined at
// build time by Expo), defaulting to the production Cloud Run URL. Unlike the web fallback,
// there is deliberately no localhost default here — a device build can't reach the host's
// localhost, so prod is the only safe default.
const PROD_API_URL = "https://clip-note-api-674775099277.us-central1.run.app";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? PROD_API_URL;
