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
  on the results screen). Every player faces the same five songs that day,
  so the daily leaderboard is a fair fight.

## The archive

**🗂️ Play the archive** (home and results screens) lists every past day back
to game #1. Archive runs are for fun: replay any day as often as you like and
share the result (tagged `(archive)` in the share text), but they never count
for the daily leaderboard and never touch your one-per-day daily attempt.
The archive list remembers your latest score for each day.

## Where the music comes from

No audio ships with this repo. Every pool entry carries a link to Apple's
official **30-second preview clip** (plus artwork, year, and album), baked
into `songs.js` at build time from the iTunes Search API — so at runtime the
game simply streams the clip and makes **no search API calls** (that API is
unreliable and rate-limited in browsers, especially mobile). If a baked URL
ever goes stale, the game re-resolves that one song with a live JSONP search
and swaps in the fresh clip mid-game. To re-bake after editing the pool, run
the `bake_pool.js` helper described in the pool file's header.

## Leaderboard (global)

The daily leaderboard is **shared across all players**: scores post to the
same Firebase Realtime Database the main game's live sync uses (REST API,
under the `drafts/songsnap` namespace its rules leave open — no SDK). The
results screen shows the top 10 plus your own rank, highlights your row, and
auto-refreshes every 30 seconds while open, so friends' scores appear as
they finish.

- Players who leave the name blank get a **unique sequential alias**
  ("Player 0001", "Player 0002", …) from an atomic counter (ETag
  compare-and-swap; random 4-digit fallback if offline).
- If posting fails (offline), the score is kept locally and **backfilled the
  next time the game is opened**; meanwhile the board falls back to
  on-device scores with an "(offline)" note.
- Archive runs never post to the board.

### Locking down the database (one-time, ~2 minutes)

By default the database path the leaderboard uses is world-writable (same as
the main game's live-draft rooms). `firebase.rules.json` in this folder locks
the SongSnap subtree down while leaving the NBA game's rooms untouched:

- score entries are **append-only** — nobody can edit or delete anyone's
  score, ever;
- entries must match the exact shape the game sends: a 1–24 char name, a
  score that's a multiple of 10 between 0 and 500, and a timestamp — nothing
  else is accepted;
- the alias counter can only ever **increment by exactly 1**, so aliases stay
  unique and nobody can vandalize the sequence;
- everything else under `drafts/songsnap` is closed.

To apply: open https://console.firebase.google.com → project
**nba-redraft** → **Build → Realtime Database → Rules** tab → replace the
contents with `firebase.rules.json` → **Publish**. The game needs no code
change and keeps working through the switch.

What this can't do (would need Firebase Auth + sign-in): stop someone who
reads the client code from posting a fake-but-valid-looking score. The rules
make the board tamper-proof, not identity-proof — fine for a friends game.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole UI — home, loading, round, results screens |
| `game.js` | Game engine: daily seeding, iTunes lookup, timers, scoring, share, leaderboard |
| `songs.js` | The song pool (title / artist / category, optional search override) |
| `styles.css` | Dark, mobile-first styling |
