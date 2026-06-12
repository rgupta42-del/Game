/**
 * Firebase configuration for LIVE online drafts (real-time sync).
 *
 * Until you paste a real config here, "Online" mode automatically falls back to
 * the zero-setup shareable-link relay (each manager passes the link on).
 *
 * To enable live sync (≈2 minutes, free):
 *   1. Go to https://console.firebase.google.com → "Add project" (any name).
 *   2. In the project, open "Build → Realtime Database" → "Create Database"
 *      → start in **test mode** (or set rules to allow read/write).
 *   3. Open "Project settings (gear) → General → Your apps → Web app (</>)",
 *      register an app, and copy the `firebaseConfig` values into the object
 *      below (apiKey, authDomain, databaseURL, projectId, appId).
 *   4. Make sure `databaseURL` is present (it looks like
 *      https://YOUR-PROJECT-default-rtdb.firebaseio.com).
 *   5. Commit this file. Done — "Online" mode is now live/real-time.
 *
 * Note: a web apiKey is meant to be public; access is governed by your Realtime
 * Database security rules, not by hiding the key.
 */
window.FIREBASE_CONFIG = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://PASTE_YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "PASTE_YOUR_PROJECT",
  appId: "PASTE_YOUR_APP_ID",
};
