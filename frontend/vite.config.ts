import { defineConfig, loadEnv, type Plugin, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Stamp dist/sw.js with a short build id so each deploy ships a byte-different service worker.
function swBuildStamp(): Plugin {
  let outDir = "dist";
  return {
    name: "sw-build-stamp",
    apply: "build",
    configResolved: (c) => void (outDir = resolve(c.root, c.build.outDir)),
    closeBundle() {
      const file = resolve(outDir, "sw.js");
      if (!existsSync(file)) return; // failed build: don't mask its real error
      let id: string;
      try {
        id = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
          .toString()
          .trim();
      } catch {
        id = "";
      }
      // ponytail: git sha alone repeats for uncommitted local builds; the timestamp keeps them unique.
      id = `${id || "nogit"}-${Date.now().toString(36)}`;
      const assets = readdirSync(resolve(outDir, "assets")).map((f) => `/assets/${f}`);
      writeFileSync(
        file,
        readFileSync(file, "utf8")
          .replaceAll("__BUILD__", id)
          .replace("/*__ASSETS__*/ []", JSON.stringify(assets)),
      );
    },
  };
}

export default defineConfig(({ command, mode }) => {
  // A build without the Firebase web config ships a blank app; refuse to produce one.
  // loadEnv merges .env* files with process.env, so local builds and CI vars both count.
  if (command === "build" && !loadEnv(mode, process.cwd(), "VITE_").VITE_FIREBASE_API_KEY)
    throw new Error("VITE_FIREBASE_API_KEY is not set; refusing to build a blank app");
  return config;
});

const config: UserConfig = {
  plugins: [
    tsconfigPaths(),
    // Router plugin must come before react() so route files are transformed first.
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    tailwindcss(),
    react(),
    swBuildStamp(),
  ],
  server: { port: 3000 },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@firebase/firestore") || id.includes("firebase/firestore"))
            return "firebase-firestore";
          if (/node_modules\/(@firebase|firebase)\//.test(id)) return "firebase-app";
          if (id.includes("@tanstack")) return "router";
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
        },
      },
    },
  },
  // The /landing route re-exports a component from ../../marketing (outside this app's
  // root), whose bare imports can't otherwise resolve. dedupe forces these to resolve
  // from frontend/node_modules — also guaranteeing a single React copy.
  resolve: { dedupe: ["react", "react-dom", "lucide-react"] },
};
