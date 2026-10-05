import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

/** Cmd/Ctrl+K from anywhere opens /search. Mount once (in __root). */
export function useSearchShortcut() {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        navigate({ to: "/search" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}
