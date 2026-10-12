// Platform detection shared by settings (shortcut setup) and the getting-started guide.

// Installed-PWA context: iOS exposes navigator.standalone, everyone else display-mode.
export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true);

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  // iPadOS 13+ reports as Mac; the touch check tells them apart.
  (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1);

export const isAndroid = () => /Android/i.test(navigator.userAgent);

// Chrome/Edge fire `beforeinstallprompt` once, early — capture it at module scope so
// the guide can offer a real install button. Safari never fires it (instructions only).
type InstallPrompt = Event & { prompt: () => Promise<void> };
let deferredInstallPrompt: InstallPrompt | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e as InstallPrompt;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferredInstallPrompt = null;
    notify();
  });
}

export function getInstallPrompt() {
  return deferredInstallPrompt;
}

/** True once the app was installed from this page (the tab itself stays non-standalone). */
export const isInstalled = () => installed || isStandalone();

/** The prompt is single-use: show it, then drop it so the Install button disappears. */
export async function promptInstall() {
  const p = deferredInstallPrompt;
  if (!p) return;
  deferredInstallPrompt = null;
  notify();
  await p.prompt();
}

export function onInstallStateChange(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
