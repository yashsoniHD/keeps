import { createFileRoute, redirect } from "@tanstack/react-router";

// The Library list now lives on the home screen (routes/index.tsx). Bare /library has no page of
// its own — only /library/$collectionId does — so redirect it home rather than render blank.
export const Route = createFileRoute("/library/")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
