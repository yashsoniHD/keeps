// Graceful fallback for a mini-app detail view that threw while rendering (e.g. a malformed
// item shape). Keeps the surrounding page + back link intact instead of crashing the whole app.
export function DetailError({ message }: { message?: string }) {
  return (
    <div className="rounded-3xl border border-border bg-card p-10 text-center">
      <p className="text-sm font-medium text-ink">Couldn't load this</p>
      <p className="mt-1 text-sm text-ink-soft">
        {message ?? "It may have been removed, or something went wrong. Head back and try again."}
      </p>
    </div>
  );
}
