const fs = require("fs");
const path = require("path");
const plist = require("@expo/plist").default;
const { withXcodeProject } = require("expo/config-plugins");

// Custom config plugin: injects a hand-written native iOS Share Extension target at prebuild.
//
// Why hand-written and not expo-share-extension: as of expo-share-extension 5.0.6 the package
// declares support only up to Expo SDK 54 (this app is SDK 57 / RN 0.86), and it drags a full
// React Native runtime into the extension. This app's extension needs none of that — it just
// reads a PAT from the shared App Group Keychain and POSTs to /api/ingest — so a ~150-line
// Swift extension is lighter and more predictable. The pbxproj wiring below mirrors
// expo-share-extension's proven approach, minus the RN packager/bundle build phases.
//
// Keychain sharing: the extension carries the same `com.apple.security.application-groups`
// entitlement as the app (an App Group id doubles as a keychain access group on iOS), so the
// Swift SecItemCopyMatching query and the JS react-native-keychain write address the same item.
// See src/lib/shared-credentials.ts for the full mechanics.

const TARGET_NAME = "ShareExtension";
const APP_GROUP = "group.com.goheydigital.clipnote";
const SWIFT_FILE = "ShareViewController.swift";
const DEPLOYMENT_TARGET = "15.1";

function bundleIdentifier(config) {
  return `${config.ios.bundleIdentifier}.${TARGET_NAME}`;
}

function writeTargetFiles(projectRoot, platformProjectRoot) {
  const targetPath = path.join(platformProjectRoot, TARGET_NAME);
  fs.mkdirSync(targetPath, { recursive: true });

  const templateDir = path.join(projectRoot, "plugins", "share-extension");

  // Swift controller — copied verbatim from the template.
  fs.copyFileSync(path.join(templateDir, SWIFT_FILE), path.join(targetPath, SWIFT_FILE));

  // Info.plist — copied verbatim (uses $(VAR) build settings).
  fs.copyFileSync(path.join(templateDir, "Info.plist"), path.join(targetPath, "Info.plist"));

  // Entitlements — the App Group is what makes the shared Keychain readable from both targets.
  const entitlements = { "com.apple.security.application-groups": [APP_GROUP] };
  fs.writeFileSync(
    path.join(targetPath, `${TARGET_NAME}.entitlements`),
    plist.build(entitlements),
  );
}

function alreadyAdded(xcodeProject) {
  const targets = xcodeProject.pbxNativeTargetSection();
  return Object.keys(targets).some((key) => {
    const t = targets[key];
    return t && typeof t === "object" && t.name && t.name.replace(/"/g, "") === TARGET_NAME;
  });
}

const withShareExtension = (config) => {
  return withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const { projectRoot, platformProjectRoot } = config.modRequest;
    const marketingVersion = config.version || "1.0.0";
    const buildNumber = config.ios?.buildNumber || "1";
    const extBundleId = bundleIdentifier(config);

    // Idempotent: `expo prebuild` (without --clean) re-runs plugins on an existing project.
    if (alreadyAdded(xcodeProject)) {
      return config;
    }

    writeTargetFiles(projectRoot, platformProjectRoot);

    const targetUuid = xcodeProject.generateUuid();
    const groupName = "Embed Foundation Extensions";
    const targetType = "app_extension";

    // 1. Build configuration list (Debug + Release) for the extension target.
    const commonBuildSettings = {
      CLANG_ENABLE_MODULES: "YES",
      CODE_SIGN_ENTITLEMENTS: `${TARGET_NAME}/${TARGET_NAME}.entitlements`,
      CURRENT_PROJECT_VERSION: `"${buildNumber}"`,
      GENERATE_INFOPLIST_FILE: "YES",
      INFOPLIST_FILE: `${TARGET_NAME}/Info.plist`,
      IPHONEOS_DEPLOYMENT_TARGET: `"${DEPLOYMENT_TARGET}"`,
      LD_RUNPATH_SEARCH_PATHS: `"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"`,
      MARKETING_VERSION: `"${marketingVersion}"`,
      PRODUCT_BUNDLE_IDENTIFIER: `"${extBundleId}"`,
      PRODUCT_NAME: `"${TARGET_NAME}"`,
      SWIFT_VERSION: "5.0",
      TARGETED_DEVICE_FAMILY: `"1,2"`,
      VERSIONING_SYSTEM: `"apple-generic"`,
      ENABLE_ON_DEMAND_RESOURCES: "NO",
    };
    const buildConfigs = [
      {
        name: "Debug",
        isa: "XCBuildConfiguration",
        buildSettings: { ...commonBuildSettings, SWIFT_ACTIVE_COMPILATION_CONDITIONS: "DEBUG" },
      },
      {
        name: "Release",
        isa: "XCBuildConfiguration",
        buildSettings: { ...commonBuildSettings },
      },
    ];
    const xCConfigurationList = xcodeProject.addXCConfigurationList(
      buildConfigs,
      "Release",
      `Build configuration list for PBXNativeTarget "${TARGET_NAME}"`,
    );

    // 2. Product file (the .appex wrapper).
    const productFile = xcodeProject.addProductFile(TARGET_NAME, {
      group: "Copy Files",
      explicitFileType: "wrapper.app-extension",
    });
    xcodeProject.addToPbxBuildFileSection(productFile);

    // 3. Native target.
    const target = {
      uuid: targetUuid,
      pbxNativeTarget: {
        isa: "PBXNativeTarget",
        name: TARGET_NAME,
        productName: TARGET_NAME,
        productReference: productFile.fileRef,
        productType: `"com.apple.product-type.app-extension"`,
        buildConfigurationList: xCConfigurationList.uuid,
        buildPhases: [],
        buildRules: [],
        dependencies: [],
      },
    };
    xcodeProject.addToPbxNativeTargetSection(target);

    // 4. Register the target on the project + a target-attributes stub.
    xcodeProject.addToPbxProjectSection(target);
    const projectUuid = xcodeProject.getFirstProject().uuid;
    const attrs = xcodeProject.pbxProjectSection()[projectUuid].attributes;
    if (!attrs.TargetAttributes) attrs.TargetAttributes = {};
    attrs.TargetAttributes[targetUuid] = { LastSwiftMigration: 1250 };

    // 5. Make the app target depend on (and embed) the extension.
    if (!xcodeProject.hash.project.objects["PBXTargetDependency"]) {
      xcodeProject.hash.project.objects["PBXTargetDependency"] = {};
    }
    if (!xcodeProject.hash.project.objects["PBXContainerItemProxy"]) {
      xcodeProject.hash.project.objects["PBXContainerItemProxy"] = {};
    }
    xcodeProject.addTargetDependency(xcodeProject.getFirstTarget().uuid, [targetUuid]);

    // 6. PBXGroup holding the extension's files, hung off the project's top-level group.
    const files = [SWIFT_FILE, "Info.plist", `${TARGET_NAME}.entitlements`];
    const { uuid: pbxGroupUuid } = xcodeProject.addPbxGroup(files, TARGET_NAME, TARGET_NAME);
    const groups = xcodeProject.hash.project.objects["PBXGroup"];
    Object.keys(groups).forEach((key) => {
      if (groups[key].name === undefined && groups[key].path === undefined) {
        xcodeProject.addToPbxGroup(pbxGroupUuid, key);
      }
    });

    // 7. Build phases. Sources compiles the Swift; Frameworks/Resources are required-but-empty;
    //    the Copy Files phase on the APP target embeds the .appex into PlugIns.
    xcodeProject.addBuildPhase([SWIFT_FILE], "PBXSourcesBuildPhase", groupName, targetUuid, targetType);
    // Two copy-files phases on the app target, mirroring the xcode lib's expectations: the
    // "Embed Foundation Extensions" phase performs the embed; the "Copy Files" phase is the one
    // addToPbxCopyfilesBuildPhase() looks up by name to attach the .appex product.
    xcodeProject.addBuildPhase([], "PBXCopyFilesBuildPhase", groupName, xcodeProject.getFirstTarget().uuid, targetType);
    xcodeProject.addBuildPhase([], "PBXCopyFilesBuildPhase", "Copy Files", xcodeProject.getFirstTarget().uuid, targetType);
    xcodeProject.addToPbxCopyfilesBuildPhase(productFile);
    xcodeProject.addBuildPhase([], "PBXFrameworksBuildPhase", groupName, targetUuid, targetType);
    xcodeProject.addBuildPhase([], "PBXResourcesBuildPhase", groupName, targetUuid, targetType);

    return config;
  });
};

module.exports = withShareExtension;
