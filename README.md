# 🏀 NBA Re-Draft — Snake Draft Dynasty Builder

A multiplayer, pass-and-play game where managers **re-draft active NBA players as
rookies** in snake order and keep them for a full **15-year career**. You're
drafting the *whole career*, not the current snapshot: every pick starts over as
a rookie and plays a normalized 15-season arc. An analytics engine then projects
every roster across those seasons — career-peak talent, how the game ages, injury
risk, team fit, two-way defense, spacing, ball dominance, winning pedigree and
locker-room culture — to crown the manager who built the best team.

> This normalizes across eras and ages: LeBron (41 today) is judged on his
> all-time **15-year career from his rookie season**, so he edges a current MVP
> like SGA; oft-injured stars (Kawhi, Embiid, Klay) get discounted from their
> peaks; and two-way wings (Klay, Kawhi) grade out far ahead of weak defenders
> (Harden) on that end.

No install, no backend, no internet required. Just open the page.

> 🎵 **Also in this repo: [SongSnap](songsnap/)** — a daily song-guessing game.
> Hear the first 5 seconds of a hit, then beat a 10-second clock to name it.
> 5 songs a day, 500 points, shareable scores. Open `songsnap/index.html` to play.

## How to play

1. Open `index.html` (or the live link) in any modern browser.
2. Pick a **mode**:
   - **Local** — everyone drafts on one device, taking turns; tick **🤖 CPU** for
     any seats you want the computer to fill.
   - **Online** — each manager plays from their own device. After you make your
     pick, hit **Copy link to send** and pass the link to the next manager; they
     open it, see the full draft so far, take their turn, and pass it on. No
     accounts, no server — the whole draft state travels in the link. (No CPUs.)
3. Choose the number of managers (2–8) and enter names.
4. Draft in **snake order**: Manager 1 → 2 → 3 → … → 3 → 2 → 1 → … The manager
   who picks last in a round picks first in the next.
5. Each manager drafts a **starting five** — **PG / SG / SF / PF / C** — with
   reasonable positional flexibility (a combo guard can slot at PG or SG, a
   forward at SF or PF, etc.). No bench. Every team's roster is visible to
   everyone throughout the draft.
6. When all fives are full, the **15-year projection** runs and ranks every team.
   Hit **📋 Copy results link to share** to send anyone a self-contained link that
   shows those exact results (no setup needed to view).

### Setup options

- **Mobile-first draft room** — the draft screen is organized like a live
  fantasy draft room: a **sticky header** with the pick clock, who's on the
  clock, and a **last-pick ticker**, above three thumb-sized tabs —
  **🏀 Players / 📋 Board / 👥 Teams**. The Players tab pulses when you're up
  and the room snaps back to it the moment it's your turn; in a live room your
  own team is pinned to the top of the Teams tab.
- **Pick clock** — off, 0:30, 0:45, 1:00 (default), 1:30 or 2:00. When it hits
  zero the best available player is auto-drafted. In **online** drafts the clock
  doesn't start until you tap **Go** on the "It's your turn!" prompt, so a manager
  who isn't at their device the second their turn comes up isn't disadvantaged.
- **Draft type & order** — **Snake** (1·2·3·4 then 4·3·2·1, default), **Linear**
  (1·2·3·4 every round), **Random** (a fresh random pick order each round so no
  seat has a built-in advantage), or **🔨 Auction**. Random orders are persisted
  so online/shared links replay the exact same sequence for everyone.
- **Auction draft** — managers take turns *nominating*; anyone can bid **+$1**
  or jump with a custom amount, and the hammer falls after 8 quiet seconds
  ("going once… going twice…"). The nominated player's card shows their key
  attributes and a **proposed value** (their curve salary normalized as a % of
  your chosen cap). Salary-cap mode is **required** (you pick the amount; every
  team must keep $1 per unfilled slot), CPU managers bid to their own private
  valuations, the draft board shows the real hammer prices, and coaches go on
  the block too. Local mode for now — online auctions are coming.
- **CPU pace** — choose ⚡ **Fast** (snappy CPU picks and bids) or 🐢 **Relaxed** (more time between CPU bids and picks), so auctions give you room to react. In auctions your **team's remaining budget and bid controls** (+$1 / +$5 / +$10 / Max / custom) are front-and-center.
- **Pinned draft HUD** — your **open positions of need** (PG SG SF PF C, + 🧠) and your **budget spent / remaining** ride in the frozen header at all times. In auctions the **bid controls are pinned** in that header too, so you never scroll to re-bid.
- **Auction nomination timer** — the pick clock becomes a per-turn nomination timer (e.g. 1:00 to put a player on the block; auto-nominates on expiry). Any player can **⏸ pause the draft** at any time (syncs to the whole room online). After you win a bid you **choose which slot** the player fills (locked mode).
- **Quick Start presets** — one-tap cards (🏆 Classic Snake, 💰 Auction Night,
  🎲 Daily Challenge, ⚡ Quick vs CPUs) fill the whole setup form; everything
  stays tweakable underneath.
- **Autosave & resume** — every pick snapshots the draft to your device; if the
  tab dies mid-draft, the home screen offers "▶ Resume your draft (Round 4,
  Pick 13)". Live rooms offer a one-tap rejoin.
- **↩ Undo** — local drafts can take back the last pick (misclick insurance).
- **📣 Share recap** — one tap copies a group-chat-ready summary (champion,
  record, steal of the draft, sim-playoff winner + results link).
- **🥊 Head-to-head rivals** — the Legends modal now also pits any two drafted
  teams against each other: win odds + a showcase best-of-7.
- **🎲 Daily 60 leaderboard** — post your composite to today's shared board
  (Firebase; see FIREBASE_SETUP.md for the one-line rules addition).
- **Scouting cards** — tap any player row to unfold full skill bars, efficiency,
  injury and era detail; ⚖️ compare two players side-by-side.
- **Installable app** — a PWA manifest + service worker: add it to your home
  screen and play offline.
- **Bench (+2)** — optional two bench rounds; bench players cover faded starters
  in the projection and count against the cap (not available in auctions).
- **One-team results** — the results screen shows a **team selector**; tap a team to see just their analysis, so the breakdown isn't a wall of every roster at once.
- **Position rules** — **Locked** (you assign each pick to a fixed open slot) or
  **Flexible** (draft freely; the lineup automatically re-arranges across
  PG↔SG↔SF↔PF↔C as long as a legal starting five remains, so you can take a second
  SG if he — or your current SG — can slide to an open, adjustable slot).
- **Eras to include** — limit the player pool to any mix of decades (80s / 90s /
  00s / 10s / 20s). Only players who starred in a checked decade are draftable.
- **Salary-cap mode** — every player (and coach) has a salary on a steep curve, so
  a franchise star eats a huge chunk and you can't stack a whole Tier-1A roster.
  The **cap is selectable** (**$150 / $175 / $200 / $225 / $250**), defaulting to
  **$200** (or **$250** with a coach). The **draft board shows each pick's salary
  and each team's running total**, so you can see where the money went in real time.
- **Draft a head coach** — each team also drafts one of the **top 30 coaches since
  the ’80s** (Phil Jackson tops the scale at a Jokić-level price, tiering down),
  **hireable at any point in the draft like a sixth position** (filter to 🧠 COACH
  on the board). A coach lifts your **cohesion** by developing a coachable group
  and by **style fit**: a defensive coach (Thibodeau, Van Gundy) elevates a
  defensive roster, a run-and-gun coach (D'Antoni, Nellie) elevates a fast, spacing
  roster, a culture coach steadies a shaky locker room — and a stylistic mismatch
  doesn't help. (Coaches use stylized arcade "head-coach" sprites.)
- **Advanced efficiency reveal** — after the draft, each team's analysis surfaces
  **true-shooting (TS%), turnover rate, usage and an estimated plus-minus/on-off
  impact** per starter. A player can look fine on the board but, like LaMelo Ball
  (low TS, high turnovers, questionable shot selection), be less efficient than the
  box score suggests — that's flagged post-finalization and modestly discounts the
  team's value.
- **Playoff bracket finale** — the results screen seeds every drafted team by
  its projected record and plays out a **simulated postseason**: best-of-7
  series with home court, per-game star lines ("G7: Jordan 46 pts"), a bracket
  champion and a **Finals MVP**. Deterministic per draft (shared links show the
  same bracket) with a 🎲 re-simulate button for the "run it back" argument.
- **Draft grades** — every pick is graded A+ through F against where the value
  actually went (hammer-price-aware in auctions), with **💎 Steal of the draft**,
  **🚨 Biggest reach**, per-team **draft GPA**, and grade chips on each roster.
- **⚔️ Challenge the Legends** — pit any drafted team against all-decade
  super-squads ('80s/'90s/'00s/'10s/'20s and the All-Time First Team): a
  Monte-Carlo win probability plus a showcase best-of-7 with a game log.
- **Arcade sound** — synthesized WebAudio effects (pick pop, your-turn chime,
  clock tick + buzzer, bid blips, auction hammer, championship fanfare) with a
  persistent 🔊/🔇 toggle in the draft header. No audio files, nothing to load.
- **Live-room reactions** — quick-tap emoji (🔥 😂 🗑️ 😱 💪 🥶) that float up
  everyone's screen in real time. Trash talk, synchronized.
- **⭐ Pick queue** — star players into a personal watchlist; if your clock
  expires, auto-pick drafts from *your* queue before falling back to best
  available.
- **Challenge modes** — 🚫⭐ **No Superstars** (only players rated ≤85) and
  🎲 **Daily 60** (a date-seeded 60-player pool that's identical for everyone
  that day — race your friends and compare results links).
- **Online auctions** — auction drafts now work in live rooms too: nominations
  and bids sync through Firebase transactions, the host keeps the hammer clock
  (with seated-device backup), and CPU bidders are host-driven.
- **Share first, draft second** — creating an online game immediately surfaces
  the invite link in a share dialog *before* you pick a seat or anything goes on
  the clock, so you can send it to your friends first.
- **Online seat choice** — the manager who creates a live room picks *which*
  seat (and therefore which draft slot) they want, rather than being forced to
  pick first.
- **2025-26 season baked in** — ratings reflect the Knicks' 2026 title (Brunson's
  unanimous Finals MVP run), Wembanyama's unanimous DPOY + Finals trip, SGA's
  back-to-back MVPs, Cade Cunningham's All-NBA leap, and the achilles wave
  (Haliburton, Lillard, Tatum) in the injury model.

### Live online drafts (real-time)

Online mode supports **real-time sync** so each manager drafts from their own
device and picks appear instantly for everyone — no link-passing. This uses
**Firebase Realtime Database** and is **opt-in**: until a config is provided,
online mode automatically falls back to the zero-setup shareable-link relay.

To enable it (free, ~5 minutes), follow the **beginner's guide** in
[`FIREBASE_SETUP.md`](FIREBASE_SETUP.md) (or the short version at the top of
[`js/firebase-config.js`](js/firebase-config.js)) and paste your Firebase web
config there. Once set, "Online" mode creates a **room link** — share it once,
each manager joins and claims their seat, and the draft syncs live. If Firebase
isn't configured (or can't load), everything still works via the link relay.

## The rules, encoded

- **Snake draft order** — `js/draft.js` builds the full pick order and enforces
  whose turn it is.
- **Positional requirements with flexibility** — every player has an `eligible`
  list of positions they can credibly play. You assign each pick to an open
  starting slot.
- **Guaranteed legal teams** — if a manager's remaining picks equal their unfilled
  starting slots, the game forces those picks onto starters so no one ends with a
  hole in the lineup.
- **Drafted for their career** — players don't leave for another team; you keep
  them as they age across the 15-year window.

## The scoring model (`js/scoring.js`)

The question the game answers: **"If you were building a team today around a
player's entire career, who would you pick?"** Every roster plays a normalized
15-season career together (everyone a rookie in year 0, everyone aging in
lockstep). Players who haven't played 15 years yet are projected forward, so a
generational young talent like Wembanyama rates as a top pick.

Players are bucketed into **talent tiers** (Superstar → All-NBA → All-Star →
Quality starter → Starter → Role player) and scored with a **value-above-
replacement** lens: a convex **dominance** bonus rewards players who can be the
best player on the floor (efficient primary shot creation), so franchise alphas
pull clearly away from ancillary/secondary pieces rather than bunching together.

Three pillars drive a player's value, with **talent doing most of the work**:

| Pillar | What it captures |
| --- | --- |
| **Peak ability** | Position-aware overall from a career-peak skill profile. Rewards elite top-end skills and on-ball creation, **but two-way defense (incl. steals & blocks) is talent too** — so a one-way scorer has a lower ceiling than an equally-skilled two-way player. Inner-circle stars land in the 90s. |
| **Career arc** | A rookie→year-15 curve, shaped per player by `earlyImpact` (great right away?) and `aging` (does the game age well — skill/IQ players sustain, athleticism-reliant ones fade). |
| **Durability** | `injuryRisk` is a *moderate* career discount, not a gutting — a fragile former-MVP (Embiid) still rates well above an excellent role player, because you'd still build around the talent. |
| **Career completion** | Active players carry an **unfinished-career discount**: the rating is part projection, so it's trimmed by how much career remains, how little résumé is *banked* (accolades / status if it ended today), and injury exposure over the remaining years. Shaq (multiple titles across teams, fully proven) outranks Wembanyama (still mostly forecast, already injured once) even at comparable talent — while a two-time-MVP champion like SGA or Jokić has banked a Hall-of-Fame case and is barely touched. |

The headline **Career rating** is talent-dominant, lightly boosted for longevity
(graceful aging + durability) and lifted by floor-raising (`elevates`) and by
being a **two-way winner who shows up in big moments** (winning + clutch +
defense). **Scoring efficiency and turnovers** matter too: inefficient,
turnover-prone volume scorers (Trae, LaMelo, Westbrook) get docked, while
efficient, careful creators (Curry, CP3) get a boost. Pure non-scorers who win
on defense alone are valuable but rated below shot creators who play serviceable
defense (Draymond < Durant).

Defense is sourced from perimeter D + steals (point-of-attack/disruption) and
interior D + blocks (rim protection), so genuine perimeter stoppers (Tatum,
Edwards) are credited correctly.

**Talent leads; team-fit/chemistry shades the result rather than deciding it.**
Elite, high-IQ players who can shoot/play off the ball coexist fine (the way they
do in the Olympics / All-Star settings), so a roster of stars isn't punished for
"usage" — only genuinely non-spacing ball-stoppers or stacked paint-bound bigs
clog things up.

**Dynamic, position-aware fit.** Each roster's composite is unique to *who is at
which slot*: a player is valued slightly higher at his natural position, and a
"lineup construction" term rewards a lead initiator at the point, shooting at the
2, a two-way wing at the 3, a stretch/glass 4, and a rim-protecting anchor at
center — so the same five players can grade out differently depending on how
they're arranged, and every addition recomputes the whole team's chemistry,
synergy and projection.

> **Performance:** per-player ratings (`careerRating`, `peakOverall`, `dominance`)
> and pairwise synergy are memoized, and the 15-season projection hoists all
> season-invariant work out of the loop — so the board, sorting and results stay
> snappy even with constant re-rendering.

On top of talent, each lineup earns a **team-fit / chemistry** grade combining
on-court fit with human factors:

- **Spacing** — enough shooting; two non-spacing bigs is penalized.
- **Playmaking** — needs a real engine.
- **Defense** — perimeter + interior plus event-creating `steals` and `blocks`;
  rewards a rim protector and a perimeter stopper.
- **Rebounding** — don't get killed on the glass.
- **Shot hierarchy** — a clear go-to scorer matters, especially in the playoffs.
- **Elevators** (`elevates`) and **passing/creation** — players who make
  teammates better lift the whole.
- **Usage / shot distribution** (`ballDominance` as a usage-rate proxy) — there's
  only one ball: you want one or two high-usage creators surrounded by off-ball
  shooters. Stacking three-plus ball-dominant scorers is a usage logjam.
- **Pairwise synergy** — every pair of teammates is scored for how they make each
  other better or worse. Two iso ball-dominant creators (Luka + Harden) step on
  each other; two paint-bound bigs (Giannis + Embiid) clog the post on offense —
  yet those same twin rim protectors *wall off the paint* on defense. Creators
  paired with spacers, lob threats and shooters lift both ends.
- **Roster construction (duplication risk & spacing-by-design)** — on top of the
  pairwise term, the engine looks at the whole five. Two bigs who both live in the
  post (Shaq + Giannis) overlap on offense and get flagged; three-plus rim
  protectors (D.Robinson + Wembanyama + Rodman) is diminishing returns that
  starves spacing, so the team's value is discounted. Conversely, a frontcourt hub
  who can pass out of the post (Duncan, KAT, Jokić) surrounded by genuine kick-out
  shooters (Reggie Miller + Ray Allen) is rewarded as **a sum greater than the
  parts** — spacing earned through construction.
- **Clutch** — proven late-game shot-makers add playoff value.
- **Culture & coachability** — a potential team cancer poisons the room; great
  culture and system-fit lift it.

**CPU drafters** are tactical but not deterministic: each computer GM gets a
temperament and a draft style, then samples among its strongest available
options (weighted toward the best), so the same human pick never yields the same
CPU draft twice.

The **results page** shows each team's clean position-by-position starting five
(with usage tier and rating), a strengths-and-weaknesses summary, the chemistry
breakdown (duplication/spacing call-outs plus notable teammate pairings, good and
bad), a plain-English **paragraph on the team's 15-year run** — the arc, the highs
and lows, and what worked and what didn't — and a 15-year win trajectory. Headline
stats include **Total Championships won** and **Best Record at Peak** — a clutch,
playoff-built team can win more titles than its average record suggests, while a
regular-season juggernaut may peak higher but close out fewer.

The board's **Fit** number is "how much does this pick help *your* roster right
now?" — your career rating plus bonuses for filling open needs, minus redundancy
penalties. On an empty roster every great player reads ~100; as you fill needs,
fit settles toward the player's raw rating.

These produce, per season:

- a **regular-season win projection** (out of 82), and
- a **playoff/championship projection** (star power + defense + fit + proven
  `winning` pedigree).

The final **composite score** blends average regular-season record, playoff depth,
expected championships over 15 years, and peak ceiling. Highest composite wins.

The results screen shows each team's average record, peak wins, expected titles,
a plain-English strengths/flaws breakdown, and a year-by-year win timeline.

## Project structure

```
index.html        # screens: setup, draft, results
styles.css        # styling
js/players.js     # curated database of active NBA players + ratings
js/draft.js       # snake-draft engine & game state
js/scoring.js     # 15-year analytics / projection engine
js/app.js         # UI controller wiring it all together
```

## Notes

- Player ratings are subjective approximations for a draft game, not an official
  scouting service. Tweak them in `js/players.js` to taste.
- The pure-logic modules (`players`, `draft`, `scoring`) also export via
  `module.exports`, so they can be unit-tested or simulated under Node.
