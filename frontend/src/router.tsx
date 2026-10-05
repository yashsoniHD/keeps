import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    // No-op where startViewTransition is unsupported. Search-param-only navigations (category
    // chips) skip it: a page-wide fade there swallows taps.
    defaultViewTransition: {
      // Hidden tabs reject startViewTransition with InvalidStateError; skip it there.
      types: ({ pathChanged }) => (pathChanged && !document.hidden ? [] : false),
    },
  });

  return router;
};

// Register the router so `to=` / `navigate()` paths are type-checked against the route tree
// (a link to a removed route then fails tsc instead of 404ing at runtime).
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
