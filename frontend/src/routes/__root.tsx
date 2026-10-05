import { useRef } from "react";
import { Outlet, createRootRoute, useRouter } from "@tanstack/react-router";
import { AuthProvider } from "@/contexts/auth-context";
import { Logo } from "@/keeps/ui";
import { CaptureProvider } from "@/components/CaptureProvider";
import { ThemeProvider } from "@/lib/theme";
import { useSearchShortcut } from "@/keeps/useSearchShortcut";
import { useEdgeSwipeBack } from "@/keeps/useEdgeSwipeBack";

function NotFoundComponent() {
  return (
    <main className="center-screen">
      <Logo />
      <h1>Nothing here</h1>
      <p>That link doesn't lead anywhere in your library.</p>
      <a href="/" className="primary">
        Back to your library
      </a>
    </main>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <main className="center-screen">
      <Logo />
      <h1>Something went sideways</h1>
      <p>We couldn't load this page. Try again or head home.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        <button
          type="button"
          className="primary"
          onClick={() => {
            router.invalidate();
            reset();
          }}
        >
          Try again
        </button>
        <a href="/" className="secondary">
          Go home
        </a>
      </div>
    </main>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  const shell = useRef<HTMLDivElement>(null);
  useSearchShortcut();
  useEdgeSwipeBack(shell);
  return (
    <ThemeProvider>
      <AuthProvider>
        <CaptureProvider>
          <div ref={shell} className="route-shell">
            <Outlet />
          </div>
        </CaptureProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
