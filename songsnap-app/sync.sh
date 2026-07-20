#!/usr/bin/env bash
# Copy the live web game into the app bundle and sync the iOS project.
# Run this after any change to ../songsnap, then rebuild in Xcode.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf www
mkdir -p www
cp ../songsnap/index.html ../songsnap/styles.css ../songsnap/game.js \
   ../songsnap/songs.js ../songsnap/songs-v1.js www/
npx cap sync ios
echo "Synced. Open with: npx cap open ios"
