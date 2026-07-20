# 📱 Shipping SongSnap to the Apple App Store

This folder is a complete, ready-to-open iOS app: the SongSnap web game
bundled into a native shell with [Capacitor](https://capacitorjs.com)
(Ionic's official wrapper — the game runs full-screen in a WKWebView with
all assets shipped inside the app). The Xcode project, app icon, splash
screen, portrait lock, and native share sheet are already configured.

What only you can do (Apple requires it): enroll as an Apple developer,
build/sign on a Mac, and submit. Here's the whole path.

## 0. One-time prerequisites

- **A Mac** with **Xcode 15+** (free, Mac App Store) and CocoaPods
  (`sudo gem install cocoapods`).
- **Apple Developer Program** membership — $99/year at
  https://developer.apple.com/programs/enroll. Approval usually takes a day.
- **Node.js 18+** on the Mac (https://nodejs.org).

## 1. Build and run locally (~10 minutes)

```bash
git clone https://github.com/rgupta42-del/Game.git
cd Game/songsnap-app
npm install
./sync.sh              # copies ../songsnap into the app bundle + syncs iOS
npx cap open ios       # opens Xcode
```

In Xcode:
1. Select the **App** target → **Signing & Capabilities** → choose your
   **Team** (appears after developer enrollment). Xcode handles certificates
   automatically.
2. The bundle ID is `com.rgupta42.songsnap` — change it if you prefer, but
   it must be globally unique and must match what you register in step 2.
3. Pick a simulator (e.g. iPhone 15) and hit **▶ Run**. Play a round —
   audio, leaderboard, share sheet should all work. Then run on your real
   phone (plug it in, select it as the destination).

## 2. Create the App Store record (~15 minutes)

1. https://appstoreconnect.apple.com → **My Apps → + → New App**.
2. Platform iOS · Name **SongSnap** (if taken, e.g. "SongSnap — Daily Song
   Quiz") · Language English · Bundle ID (register the same one at
   https://developer.apple.com/account/resources/identifiers first) ·
   SKU anything (e.g. `songsnap-1`).
3. Fill the product page: description, keywords, support URL (your GitHub
   Pages link works), and screenshots — run the app on an iPhone 15 Pro Max
   simulator and press **⌘S** for each screen (home, guess phase, results);
   Apple wants 6.7" shots, the simulator produces the right size.
4. **App Privacy** questionnaire: the game collects **Name** (optional,
   user-provided) and **Gameplay Content** (scores), not linked to identity,
   not used for tracking. You'll need a privacy policy URL — a page in this
   repo describing that is enough; ask Claude to generate one.
5. Age rating: answers all "No" → 4+.

## 3. Upload and submit (~15 minutes)

1. In Xcode: destination **Any iOS Device (arm64)** → menu **Product →
   Archive**.
2. In the Organizer window that opens: **Distribute App → App Store
   Connect → Upload** (accept defaults).
3. Back in App Store Connect, the build appears under **TestFlight** in
   ~15 minutes. **Strongly recommended:** install via TestFlight on your
   own phone first and play a full day.
4. On the app page: select the build, then **Add for Review → Submit**.
   Review typically takes 1–3 days.

## Honest heads-ups (read before submitting)

- **Guideline 4.2 (minimum functionality).** Apple sometimes rejects apps
  that are "just a website in a wrapper." SongSnap has a decent case — it's
  a game with native share, daily mechanics, offline-bundled assets — but if
  you get a 4.2 rejection, the fix is adding more native texture (haptics on
  answers, push notification for the daily drop, Game Center leaderboard).
  Ask Claude — all three are Capacitor plugins away.
- **Music previews.** The game streams Apple's own official 30-second
  preview clips from Apple's CDN. That's the same source every iTunes-API
  app uses, but Apple's API terms technically frame previews as promotional
  content for the store. If review pushes back, the mitigation is adding a
  "Listen on Apple Music" link on each reveal (which arguably makes the app
  promote Apple Music). This is the main external risk — same one every
  Heardle-style app carries.
- **Leaderboard writes** go to your Firebase database; apply the
  `songsnap/firebase.rules.json` lockdown before wide release.
- **Icon alpha**: if Xcode warns the App Store icon has an alpha channel,
  open `Assets.xcassets/AppIcon` in Preview → File → Export → uncheck
  Alpha → replace.

## Updating the app later

The game itself updates instantly for web players, but the app bundles its
own copy. After changing `../songsnap`: run `./sync.sh`, bump **Version**
in Xcode (e.g. 1.0.1), re-archive, upload, submit. (If you later want
web-style instant updates inside the app, Capacitor supports pointing at
the live URL or using a live-update service — trade-offs apply; ask Claude.)
