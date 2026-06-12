import { Component, type ReactNode } from "react";
import { reportClientError } from "@/lib/client-errors";

// React unmounts the whole tree on an uncaught render error — for a notes app that
// reads as "the app is broken" over one malformed AI-shaped `data` map. This boundary
// contains the blast radius to the component it wraps and ships the error to the
// /api/client-errors sink so bad shapes are visible in Cloud Logging.
export class ErrorBoundary extends Component<
  { fallback: ReactNode; label?: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    reportClientError(`render:${this.props.label ?? "boundary"}`, error.message, error.stack);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
