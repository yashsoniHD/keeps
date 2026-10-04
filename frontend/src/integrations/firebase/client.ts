import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  ...(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
    ? { measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID }
    : {}),
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// IndexedDB-backed cache: the feed and note views render from disk instantly (and offline),
// then onSnapshot revalidates. Multi-tab manager so a second tab doesn't fail to get the lease.
// Browsers without IndexedDB (some private modes) fall back to memory inside the SDK.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// Analytics is optional — requires VITE_FIREBASE_MEASUREMENT_ID and browser support.
// Get the measurement ID from Firebase Console → Project Settings → Your apps → Web app.
export const analyticsReady: Promise<ReturnType<typeof getAnalytics> | null> = import.meta.env
  .VITE_FIREBASE_MEASUREMENT_ID
  ? isSupported().then((ok) => (ok ? getAnalytics(app) : null))
  : Promise.resolve(null);
