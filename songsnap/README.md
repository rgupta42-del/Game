# 🎵 SongSnap — Daily Song Quiz

Hear the first **5 seconds** of a hit, then race a **10-second clock** to pick
it out of **5 options**. Five songs a day, **500 points** on the line, a share
button and a daily leaderboard. No install, no backend, no accounts.

## How to play

1. Open `songsnap/index.html` (or the live link) in any modern browser.
2. Enter a name (it goes on the leaderboard) and hit **Play today's mix**.
3. Each round: press **Play the clip**, listen to 5 seconds, then the guess
   window opens with 5 choices. The faster you answer, the more you score:

   | Answered in… | Points |
   |---|---|
   | 1st second | 100 |
   | 2nd second | 90 |
   | 3rd second | 80 |
   | … | … |
   | 10th second | 10 |
   | Time's up / wrong | 0 |

4. While the clock runs you can use two small buttons:
   - **🔁 Replay** — hear the 5-second clip again, free. The timer keeps
     running and you can still answer mid-replay.
   - **💡 Hint - Lose 30pts** — a written hint (release year + album, or the
     artist's first letter) for −30 pts off that round, floor 0.

   At the **5-second mark**, 2 of the wrong options disappear, leaving a
   3-way choice. A wrong guess still scores 0, whenever it happens.
5. After 5 rounds you get your total out of 500, a **📣 Share** button
   (Web Share on phones, clipboard elsewhere), and **today's leaderboard**.

## The daily mix

- Everyone gets the **same 5 songs each day** — the mix is picked
  deterministically from a ~180-song pool seeded by the date, with at most
  2 songs per category for variety.
- Categories: **90s pop, 00s pop, pop rock, hip hop, and recent pop**.
- One play per day per device; a new mix drops at local midnight (countdown
  on the results screen).

## Where the music comes from

No audio ships with this repo. Each day's tracks are resolved at runtime
against the **iTunes Search API** (JSONP, so it works from any static host or
even `file://`), and the game plays the first 5 seconds of Apple's official
30-second preview clip. If a preview is unavailable, the daily walk
deterministically skips to the next candidate, so everyone still gets the
same five.

## Leaderboard scope

The daily leaderboard is stored in `localStorage`, so it ranks players **on
the same device** (great for pass-and-play) — challenge remote friends with
the share button. Hooking it to Firebase for a global board would follow the
same pattern as the main game's `FIREBASE_SETUP.md`.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole UI — home, loading, round, results screens |
| `game.js` | Game engine: daily seeding, iTunes lookup, timers, scoring, share, leaderboard |
| `songs.js` | The song pool (title / artist / category, optional search override) |
| `styles.css` | Dark, mobile-first styling |
