// One-time rename of localStorage keys clipnote-* / clipnote.* -> keeps-* / keeps.*
// (keeps the offline capture queue and theme). Imported first in main.tsx.
try {
  for (const k of Object.keys(localStorage)) {
    if (!/^clipnote[-.]/.test(k)) continue;
    const next = "keeps" + k.slice("clipnote".length);
    if (localStorage.getItem(next) === null)
      localStorage.setItem(next, localStorage.getItem(k) as string);
    localStorage.removeItem(k);
  }
} catch {
  // storage unavailable
}
