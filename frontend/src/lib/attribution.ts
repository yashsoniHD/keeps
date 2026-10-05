// Signup attribution. We stash where a visitor came from (a ?ref= / utm_source on the
// landing page, or "shared-note" when they arrive via a public /p link) and attach it to
// the account on first sign-in, so the admin dashboard can break signups down by source.

const REF_KEY = "keeps.signupRef";

// Capture an attribution source from the current URL (best-effort, first-write-wins so the
// original source isn't overwritten by a later internal navigation).
export function captureSignupRef(): void {
  try {
    const p = new URLSearchParams(window.location.search);
    const ref = p.get("ref") || p.get("utm_source") || p.get("utm_campaign");
    if (ref && !localStorage.getItem(REF_KEY)) localStorage.setItem(REF_KEY, ref.slice(0, 64));
  } catch {
    /* storage/URL unavailable — attribution is non-critical */
  }
}

// Explicitly set the source (e.g. a "Save this shared note" tap), first-write-wins.
export function setSignupRef(ref: string): void {
  try {
    if (!localStorage.getItem(REF_KEY)) localStorage.setItem(REF_KEY, ref.slice(0, 64));
  } catch {
    /* ignore */
  }
}

export function readSignupRef(): string | null {
  try {
    return localStorage.getItem(REF_KEY);
  } catch {
    return null;
  }
}

export function clearSignupRef(): void {
  try {
    localStorage.removeItem(REF_KEY);
  } catch {
    /* ignore */
  }
}
