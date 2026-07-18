import { Platform } from "react-native";
import * as Keychain from "react-native-keychain";
import * as Device from "expo-device";

import { createToken, listTokens, revokeToken } from "./api";

// Bridges the signed-in app and its iOS share extension: the app mints a Personal Access
// Token (PAT) and parks it in the *shared* iOS Keychain access group so the share extension
// (a separate process with no Firebase session) can read it and POST captures on its own.
//
// Keychain access group mechanics — the #1 integration risk:
//   iOS grants a process the keychain access groups listed in its `keychain-access-groups`
//   entitlement PLUS every App Group in its `com.apple.security.application-groups`
//   entitlement (Apple: "Sharing access to keychain items among a collection of apps").
//   An App Group id (`group.*`) is therefore a valid keychain access group *without* the
//   team-id prefix a normal keychain group needs — which is why we can hardcode it here
//   with no build-time knowledge of the Apple Team ID. Both the app and the extension carry
//   the same App Group entitlement (see app.json + plugins/withShareExtension.js), so an item
//   written with kSecAttrAccessGroup = APP_GROUP is readable by both.
//
//   react-native-keychain passes our `accessGroup` option straight through to
//   kSecAttrAccessGroup (RNKeychainManager.m), and the Swift extension queries with the
//   identical (service, account, accessGroup) triple — so both sides address the same item.
const APP_GROUP = "group.com.goheydigital.clipnote";
const KEYCHAIN_SERVICE = "com.goheydigital.clipnote.pat";
const KEYCHAIN_ACCOUNT = "clipnote";

// Every PAT this app mints is labelled with this prefix so we can find-and-replace our own
// token (revoke-and-replace on re-mint) and tag it "This device" in Settings, without
// touching PATs the user created elsewhere (e.g. an iOS Shortcut).
const PAT_LABEL_PREFIX = "iOS App – ";

const KEYCHAIN_OPTS = {
  service: KEYCHAIN_SERVICE,
  accessGroup: APP_GROUP,
  // AFTER_FIRST_UNLOCK: the share extension must read the PAT whenever the user shares,
  // including right after a reboot (the app may not have run yet in that boot).
  accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
} as const;

// The label this device's PAT gets — used both when minting and (in Settings) to tag the
// matching row as "This device".
export function sharedPatLabel(): string {
  const name = Device.deviceName || Device.modelName || "iPhone";
  return `${PAT_LABEL_PREFIX}${name}`;
}

// True for a label minted by this device track (any device), so Settings can tag our own
// tokens and we can revoke-and-replace them on re-mint.
export function isAppPatLabel(label: string | undefined | null): boolean {
  return typeof label === "string" && label.startsWith(PAT_LABEL_PREFIX);
}

async function readStoredPat(): Promise<string | null> {
  const result = await Keychain.getGenericPassword(KEYCHAIN_OPTS);
  return result ? result.password : null;
}

// `cn_<id>.<secret>` → the doc id, which is what DELETE /api/tokens/{id} expects.
function tokenId(token: string): string | null {
  const m = /^cn_([^.]+)\./.exec(token);
  return m ? m[1] : null;
}

// The token id currently held in the shared Keychain — the robust "is this row this
// device?" identity (labels drift when the device is renamed after minting).
export async function storedPatTokenId(): Promise<string | null> {
  if (Platform.OS !== "ios") return null;
  try {
    const stored = await readStoredPat();
    return stored ? tokenId(stored) : null;
  } catch {
    return null;
  }
}

// Ensure the shared Keychain holds a live PAT for the share extension. Called after sign-in
// and on every app foreground; a no-op when a token is already stored, so foreground calls
// only mint when the Keychain entry is missing (fresh install, post-restore, manual revoke).
//
// Revoke-and-replace: minting first sweeps out any prior "iOS App – " PAT so the per-user
// 5-token cap can't fill up with stale device tokens. Entirely best-effort — a failure here
// must never block sign-in, so everything is swallowed (the extension just falls back to its
// "Open Clipnote to reconnect" path until the next successful sync).
// Sign-in and app-foreground can both trigger a sync while a mint's network round-trip is
// still in flight; without a lock that double-mints and orphans a live token (only the last
// Keychain write wins). One shared in-flight promise makes concurrent callers await the
// same sync instead.
let syncInFlight: Promise<void> | null = null;

export function syncSharedPat(): Promise<void> {
  if (Platform.OS !== "ios") return Promise.resolve();
  if (!syncInFlight) {
    syncInFlight = doSyncSharedPat().finally(() => {
      syncInFlight = null;
    });
  }
  return syncInFlight;
}

async function doSyncSharedPat(): Promise<void> {
  try {
    if (await readStoredPat()) return;

    // Revoke any token this track minted before (previous install / stale device entry).
    try {
      const existing = await listTokens();
      await Promise.all(
        existing.filter((t) => isAppPatLabel(t.label)).map((t) => revokeToken(t.id).catch(() => {})),
      );
    } catch {
      // Listing is a nice-to-have cleanup; if it fails we still mint (cap errors surface below).
    }

    const { token } = await createToken(sharedPatLabel());
    await Keychain.setGenericPassword(KEYCHAIN_ACCOUNT, token, KEYCHAIN_OPTS);
  } catch (err) {
    console.warn("[shared-credentials] Could not sync the share-extension token.", err);
  }
}

// Sign-out / revoke cleanup: drop the shared Keychain entry and best-effort revoke the token
// server-side. Must run while the Firebase session is still valid (revoke needs it), so
// callers invoke this BEFORE firebaseSignOut. Never throws.
export async function clearSharedPat(): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    const stored = await readStoredPat();
    await Keychain.resetGenericPassword(KEYCHAIN_OPTS);
    if (stored) {
      const id = tokenId(stored);
      if (id) await revokeToken(id).catch(() => {});
    }
  } catch (err) {
    console.warn("[shared-credentials] Could not clear the share-extension token.", err);
  }
}
