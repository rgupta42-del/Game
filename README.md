# 🏀 NBA Re-Draft — Snake Draft Dynasty Builder

A multiplayer, pass-and-play game where managers **re-draft active NBA players as
rookies** in snake order and keep them for their entire (realized or anticipated)
careers. An analytics engine then projects every roster across **15 seasons** —
factoring talent, team fit, age curves, and injury risk — to crown the manager
who built the best team.

No install, no backend, no internet required. Just open the page.

## How to play

1. Open `index.html` in any modern browser.
2. Choose the number of managers (2–8) and bench spots, and enter names.
3. Draft in **snake order**: Manager 1 → 2 → 3 → … → 3 → 2 → 1 → … The manager
   who picks last in a round picks first in the next.
4. Each manager must fill all five positions — **PG / SG / SF / PF / C** — with
   reasonable positional flexibility (a combo guard can slot at PG or SG, a
   forward at SF or PF, etc.). Bench spots accept anyone.
5. When the board is full, the **15-year projection** runs and ranks every team.

## The rules, encoded

- **Snake draft order** — `js/draft.js` builds the full pick order and enforces
  whose turn it is.
- **Positional requirements with flexibility** — every player has an `eligible`
  list of positions they can credibly play. You assign each pick to an open
  starting slot or the bench.
- **Guaranteed legal teams** — if a manager's remaining picks equal their unfilled
  starting slots, the game forces those picks onto starters so no one ends with a
  hole in the lineup.
- **Drafted for their career** — players don't leave for another team; you keep
  them as they age across the 15-year window.

## The scoring model (`js/scoring.js`)

Each roster is simulated for 15 seasons. Three pillars drive a player's value:

| Pillar | What it captures |
| --- | --- |
| **Talent** | Position-aware overall from a skill profile (scoring, shooting, playmaking, rebounding, perimeter & interior defense, athleticism, IQ), with a peak-skill bonus so elite specialists aren't dragged to the mean. |
| **Career arc** | A development-and-decline curve peaking ~age 27–28. Young, high-`potential` players are credited with *anticipated* growth toward their ceiling. |
| **Availability** | `injuryRisk` (history + age-related wear) reduces a player's effective value each season. Bench depth insures against injuries and aging. |

On top of raw talent, each lineup earns a **team-fit / chemistry** grade:

- **Spacing** — enough shooting; two non-spacing bigs is penalized.
- **Playmaking** — needs a real engine; too many ball-dominant alphas is penalized.
- **Defense** — blends perimeter & interior; rewards a rim protector and a stopper.
- **Rebounding** — don't get killed on the glass.
- **Shot hierarchy** — a clear go-to scorer matters, especially in the playoffs.

These produce, per season:

- a **regular-season win projection** (out of 82), and
- a **playoff/championship projection** (star power + defense + fit).

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
