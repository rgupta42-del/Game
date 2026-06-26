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

- **Pick clock** — off, 0:30, 0:45, 1:00 (default), 1:30 or 2:00. When it hits
  zero the best available player is auto-drafted.
- **Eras to include** — limit the player pool to any mix of decades (80s / 90s /
  00s / 10s / 20s). Only players who starred in a checked decade are draftable.
- **Salary-cap mode** — each team gets a **$200 cap**. Every player has a salary
  derived from their rating on a steep curve, so a franchise star eats a huge
  chunk and you can't stack a whole Tier-1A roster — you build a star or two
  around value pieces.
- **Online seat choice** — the manager who creates a live room now picks *which*
  seat (and therefore which draft slot) they want, rather than being forced to
  pick first.

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
