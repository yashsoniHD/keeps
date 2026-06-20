import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    // Router plugin must come before react() so route files are transformed first.
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    tailwindcss(),
    react(),
  ],
  server: { port: 3000 },
  // The /landing route re-exports a component from ../../marketing (outside this app's
  // root), whose bare imports can't otherwise resolve. dedupe forces these to resolve
  // from frontend/node_modules — also guaranteeing a single React copy.
  resolve: { dedupe: ["react", "react-dom", "lucide-react"] },
});
