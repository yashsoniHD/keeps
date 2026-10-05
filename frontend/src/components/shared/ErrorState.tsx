import { Logo } from "@/keeps/ui";

// A full-height error / empty panel in the Keeps style (same markup as the root NotFound/Error
// screens): title, soft body, and up to two actions (an optional Retry and "Back to your library").
export function ErrorState({
  title,
  body,
  onRetry,
  retryLabel = "Retry",
  showHome = true,
}: {
  title: string;
  body?: string;
  onRetry?: () => void;
  retryLabel?: string;
  showHome?: boolean;
}) {
  return (
    <main className="center-screen">
      <Logo />
      <h1>{title}</h1>
      {body && <p>{body}</p>}
      {(onRetry || showHome) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          {onRetry && (
            <button type="button" className="primary" onClick={onRetry}>
              {retryLabel}
            </button>
          )}
          {showHome && (
            <a href="/" className="primary">
              Back to your library
            </a>
          )}
        </div>
      )}
    </main>
  );
}
