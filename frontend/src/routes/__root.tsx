import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, useRouter } from "@tanstack/react-router";
import { PillButton, PillLink, pillClasses } from "@/components/shared/PillButton";
import { AuthProvider } from "@/contexts/auth-context";
import { AskProvider } from "@/contexts/ask-context";
import { CategoryMetaProvider } from "@/contexts/category-meta";
import { AskFab } from "@/components/ask/AskFab";
import { BottomNav } from "@/components/BottomNav";
import { CaptureProvider } from "@/components/CaptureProvider";
import { ThemeProvider } from "@/lib/theme";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-7xl text-ink">404</h1>
        <h2 className="mt-4 font-serif text-2xl text-ink">Nothing here</h2>
        <p className="mt-2 text-sm text-ink-soft">
          That link doesn't lead anywhere in your library.
        </p>
        <div className="mt-6">
          <PillLink to="/">Back to your library</PillLink>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-2xl text-ink">Something went sideways</h1>
        <p className="mt-2 text-sm text-ink-soft">
          We couldn't load this page. Try again or head home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <PillButton
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            Try again
          </PillButton>
          <a href="/" className={pillClasses("secondary", "md")}>
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <ThemeProvider>
      <AuthProvider>
        <CategoryMetaProvider>
          <QueryClientProvider client={queryClient}>
            <AskProvider>
              <CaptureProvider>
                {/* Bottom padding clears the mobile tab bar on every route; desktop has none. */}
                <div className="pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">
                  <Outlet />
                </div>
                {/* Global Ask-AI FAB + chat overlay; hides itself on signed-out routes. */}
                <AskFab />
                {/* Mobile-only bottom tab bar (Home · Collections · + · Ask · Search). */}
                <BottomNav />
              </CaptureProvider>
            </AskProvider>
          </QueryClientProvider>
        </CategoryMetaProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
