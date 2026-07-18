// Metro config: NativeWind + npm-workspace (monorepo) resolution.
//
// Expo SDK 57's `getDefaultConfig` already auto-detects the monorepo root and enables
// symlink resolution, but we set watchFolders + nodeModulesPaths explicitly so the
// symlinked TS-source workspace package "@clipnote/shared" resolves from the repo root
// and Metro watches it for changes.
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// Watch the whole workspace so edits to packages/shared trigger fast refresh.
config.watchFolders = [workspaceRoot];

// Resolve from the app's node_modules first, then the hoisted root node_modules.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = withNativeWind(config, { input: "./src/global.css" });
