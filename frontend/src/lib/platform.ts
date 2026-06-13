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
let deferredInstallPrompt: (Event & { prompt: () => Promise<void> }) | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e as Event & { prompt: () => Promise<void> };
  });
}

export function getInstallPrompt() {
  return deferredInstallPrompt;
}
