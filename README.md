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

## How to play

1. Open `index.html` in any modern browser.
2. Choose the number of managers (2–8), tick **🤖 CPU** for any empty seats, and
   enter names.
3. Draft in **snake order**: Manager 1 → 2 → 3 → … → 3 → 2 → 1 → … The manager
   who picks last in a round picks first in the next.
4. Each manager drafts a **starting five** — **PG / SG / SF / PF / C** — with
   reasonable positional flexibility (a combo guard can slot at PG or SG, a
   forward at SF or PF, etc.). No bench. Every team's roster is visible to
   everyone throughout the draft.
5. When all fives are full, the **15-year projection** runs and ranks every team.

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

Three pillars drive a player's value, with **talent doing most of the work**:

| Pillar | What it captures |
| --- | --- |
| **Peak ability** | Position-aware overall from a career-peak skill profile, rewarding elite top-end skills and on-ball shot creation — what separates a franchise #1 from a great role player. Inner-circle stars land in the 90s. |
| **Career arc** | A rookie→year-15 curve, shaped per player by `earlyImpact` (great right away?) and `aging` (does the game age well — skill/IQ players sustain, athleticism-reliant ones fade). |
| **Durability** | `injuryRisk` is a *moderate* career discount, not a gutting — a fragile former-MVP (Embiid) still rates well above an excellent role player, because you'd still build around the talent. |

The headline **Career rating** is talent-dominant, lightly boosted for longevity
(graceful aging + durability) and nudged by intangibles (mostly teammate
elevation; winning is a light touch). This is why LeBron's all-time 15-year
career lands in the mid-90s, fragile stars like Kawhi/Embiid/Klay stay high
despite injury risk, and proven winners get a small bump rather than a big one.

On top of talent, each lineup earns a **team-fit / chemistry** grade combining
on-court fit with human factors:

- **Spacing** — enough shooting; two non-spacing bigs is penalized.
- **Playmaking** — needs a real engine.
- **Defense** — blends perimeter & interior; rewards a rim protector and a stopper.
- **Rebounding** — don't get killed on the glass.
- **Shot hierarchy** — a clear go-to scorer matters, especially in the playoffs.
- **Elevators** (`elevates`) — players who make teammates better lift the whole.
- **Usage / shot distribution** (`ballDominance` as a usage-rate proxy) — there's
  only one ball: you want one or two high-usage creators surrounded by off-ball
  shooters. Stacking three-plus ball-dominant scorers is a usage logjam.
- **Culture & coachability** — a potential team cancer poisons the room; great
  culture and system-fit lift it.

**CPU drafters** are tactical but not deterministic: each computer GM gets a
temperament and a draft style, then samples among its strongest available
options (weighted toward the best), so the same human pick never yields the same
CPU draft twice.

The **results page** shows each team's clean position-by-position starting five
(with usage tier and rating) plus a short strengths-and-weaknesses summary and a
15-year win trajectory.

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
