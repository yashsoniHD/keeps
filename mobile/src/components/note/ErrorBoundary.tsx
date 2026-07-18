import { Component, type ReactNode } from "react";

// Minimal render error boundary for the note template ladder — a bad AI `data` shape hitting a
// typed template degrades to the next fallback instead of white-screening the screen. Mirrors the
// role of frontend/src/components/ErrorBoundary.tsx (the browser error sink is web-only, so this
// just logs to the console).
export class ErrorBoundary extends Component<
  { fallback: ReactNode; label?: string; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    console.error(`[note:${this.props.label ?? "render"}]`, error);
  }

  render(): ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
