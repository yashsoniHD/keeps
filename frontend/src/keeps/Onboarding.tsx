import { useEffect, useRef } from "react";
import { Icon, Logo } from "./ui";

const STEPS = [
  ["Copy the link", "From an article, video, or post you want to save."],
  ["Tap + in Keeps", "Paste your link and tap Save link."],
  ["Come back to it", "Browse your library or search for a detail you remember."],
];

/** Full-screen "how to save a link" guide. */
export default function Onboarding({ onDone }: { onDone: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && done.current();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, []);
  return (
    <div
      className="onboarding"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        overflow: "auto",
        background: "var(--k-bg)",
      }}
    >
      <div className="onboard-top">
        <Logo />
        <button
          ref={closeRef}
          type="button"
          className="icon-button"
          aria-label="Close help"
          onClick={onDone}
        >
          <Icon name="X" />
        </button>
      </div>
      <section className="save-help">
        <h1>Keep a useful link</h1>
        <ol>
          {STEPS.map(([h, p], i) => (
            <li key={h}>
              <span>{i + 1}</span>
              <div>
                <h2>{h}</h2>
                <p>{p}</p>
              </div>
            </li>
          ))}
        </ol>
        <button type="button" className="primary wide" onClick={onDone}>
          Got it
        </button>
      </section>
    </div>
  );
}
