# 🔌 Firebase Live Sync — Beginner's Setup Guide

This turns **Online** mode into true real-time multiplayer: every manager drafts
from their own device and picks appear instantly for everyone (no link-passing).

It's **free**, takes about **5 minutes**, and you only do it **once**. Until you
finish, Online mode still works using the shareable-link relay — so there's no
rush and nothing breaks.

> You'll need a Google account (Gmail). That's it.

---

## Step 1 — Open the Firebase Console

1. Go to **https://console.firebase.google.com/**
2. Sign in with your Google account.

---

## Step 2 — Create a project

1. Click **“Create a project”** (or **“Add project”**).
2. **Project name:** type anything, e.g. `nba-redraft`. Click **Continue**.
3. **Google Analytics:** you don't need it — toggle it **OFF**, then click
   **Create project** (or **Continue**).
4. Wait ~30 seconds for it to finish, then click **Continue**. You'll land on the
   project dashboard.

---

## Step 3 — Create the Realtime Database

> ⚠️ Make sure you pick **Realtime Database**, *not* “Firestore Database”. They're
> different products; this app uses Realtime Database.

1. In the left sidebar, find the **Build** section and click **Realtime Database**.
   (If you don't see a sidebar, click the **☰** menu first.)
2. Click **Create Database**.
3. **Location:** pick the one closest to your players (e.g. *United States
   (us-central1)*). Click **Next**.
4. **Security rules:** choose **Start in test mode**. Click **Enable**.
   - Test mode lets the app read/write for 30 days. Step 6 shows how to make it
     permanent.
5. You'll now see your database. **Copy the URL** shown at the top — it looks like:
   ```
   https://nba-redraft-default-rtdb.firebaseio.com
   ```
   (If you chose a non-US region it may look like
   `https://nba-redraft-default-rtdb.europe-west1.firebasedatabase.app` — that's
   fine, just copy whatever is shown.) You'll need this in Step 5.

---

## Step 4 — Register a Web App and get your config

1. Click the **⚙️ gear icon** at the top-left (next to “Project Overview”) →
   **Project settings**.
2. Scroll down to **“Your apps”** and click the **web icon** that looks like
   **`</>`**.
3. **App nickname:** type `web`. **Do NOT** check “Also set up Firebase Hosting”.
   Click **Register app**.
4. Firebase shows a code snippet containing a `firebaseConfig` object like this:
   ```js
   const firebaseConfig = {
     apiKey: "AIzaSyABC123...",
     authDomain: "nba-redraft.firebaseapp.com",
     databaseURL: "https://nba-redraft-default-rtdb.firebaseio.com",
     projectId: "nba-redraft",
     storageBucket: "nba-redraft.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abc123",
   };
   ```
   Keep this tab open — you'll copy these values next.

   > **If `databaseURL` is missing from the snippet**, that's normal. Use the URL
   > you copied in Step 3.

---

## Step 5 — Paste your config into the game

1. Open the file **`js/firebase-config.js`** in this project.
2. Replace the placeholder values with **your** values from Step 4. Only these
   five fields matter (you can leave the others out):

   ```js
   window.FIREBASE_CONFIG = {
     apiKey: "AIzaSyABC123...",                                  // your apiKey
     authDomain: "nba-redraft.firebaseapp.com",                  // your authDomain
     databaseURL: "https://nba-redraft-default-rtdb.firebaseio.com", // your databaseURL
     projectId: "nba-redraft",                                   // your projectId
     appId: "1:123456789:web:abc123",                            // your appId
   };
   ```

3. **Double-check `databaseURL`** — this is the one people most often get wrong.
   It must be the exact URL from Step 3 and must NOT contain the word `PASTE_`.
4. **Save**, then commit and push so it goes live:
   ```bash
   git add js/firebase-config.js
   git commit -m "Add Firebase config for live sync"
   git push
   ```
   (Or just ask me to commit it for you.)

> 🔒 **Is it safe to put the apiKey in a public file?** Yes. A Firebase web
> `apiKey` is meant to be public — it only identifies your project. What actually
> protects your data is the **database rules** (Step 6), not hiding the key.

---

## Step 6 — Make it permanent (recommended)

Test mode stops working after 30 days. To keep live sync running, set simple
rules that allow the game to read/write its draft rooms:

1. Go to **Realtime Database** → the **Rules** tab.
2. Replace what's there with:
   ```json
   {
     "rules": {
       "drafts": {
         ".read": true,
         ".write": true
       }
     }
   }
   ```
3. Click **Publish**.

This lets anyone who has a room link read/write that room (fine for a friendly
game). It does **not** expose anything else in your project.

---

## Step 7 — Test it

1. Open the live site (e.g. `https://YOURNAME.github.io/Game/`).
2. Choose **Online** mode, enter manager names, click **Start Online Draft**.
3. You'll get a **room link** and see “🟢 Your turn”. Copy the link.
4. Open that link in a **different browser** (or an incognito window, or your
   phone). Pick a different seat when prompted.
5. Make a pick in one window — it should appear **instantly** in the other. 🎉

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Online mode still passes a link instead of syncing live | Config not detected. Make sure `js/firebase-config.js` has real values (no `PASTE_`) and that you pushed/refreshed. |
| “Permission denied” in the browser console | Your database rules block writes. Do Step 6, or re-enable test mode. |
| Picks don't sync between devices | `databaseURL` is wrong or missing. Re-copy the exact URL from Step 3 into the config. |
| “live draft link, but live sync isn't configured” alert | The deployment opening the room link doesn't have the config. Make sure the config is committed/deployed. |
| Nothing loads at all | Open the browser console (F12) and check for errors; confirm the Firebase `<script>` tags in `index.html` loaded (no network blocks). |

Free tier (the **Spark** plan) is far more than enough for drafting — you won't
be charged. If you ever want to tear it down, just delete the Firebase project.


## Daily 60 leaderboard (optional)

The Daily 60 challenge posts scores to `/leaderboards/{date}`. Add this to your
Realtime Database rules alongside the `drafts` block:

```json
"leaderboards": {
  ".read": true,
  ".write": true
}
```
