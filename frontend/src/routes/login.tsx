import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Logo } from "@/keeps/ui";
import { useAuth } from "@/contexts/auth-context";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
});

function LoginPage() {
  const { user, loading, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const { redirect } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) {
      // Same-origin paths only — never replay an absolute URL (open-redirect guard).
      if (redirect && redirect.startsWith("/") && !redirect.startsWith("//")) {
        router.history.replace(redirect);
      } else {
        navigate({ to: "/" });
      }
    }
  }, [user, loading, navigate, router, redirect]);

  const handleSignIn = async () => {
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      // Surface the Firebase error code (e.g. auth/unauthorized-domain,
      // auth/popup-blocked) — the generic message alone made failures undiagnosable.
      const code = (err as { code?: string })?.code;
      console.error("[auth] sign-in failed:", code ?? err);
      setError(
        code === "auth/popup-closed-by-user"
          ? "Sign-in was cancelled."
          : `Sign-in didn't complete${code ? ` (${code})` : ""}. Please try again.`,
      );
    }
  };

  return (
    <main className="login-screen">
      <Logo />
      <h1>Save any link. Keep what matters.</h1>
      <p>Paste or share a link and Keeps turns it into a note you can search later.</p>
      <button type="button" className="google-button" onClick={handleSignIn}>
        <svg className="h-5 w-5" viewBox="0 0 24 24">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        Continue with Google
      </button>
      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
