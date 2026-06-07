/**
 * Analytics engine for the NBA Re-Draft game.
 *
 * The premise: you draft players as "rookies" and keep them for their whole
 * career (realized or anticipated). We project every roster across a 15-season
 * window and estimate how it would perform, then crown the most analytically
 * sound team.
 *
 * The model has three pillars:
 *   1. TALENT        - how good each player is (skill profile -> overall).
 *   2. CAREER ARC    - how that talent rises and falls with age, plus the
 *                      anticipated growth of young, high-upside players.
 *   3. AVAILABILITY  - injury risk (history + age) eats into a player's value;
 *                      bench depth insures against it.
 *
 * On top of raw talent we score TEAM FIT (spacing, playmaking, defense,
 * rebounding, shot hierarchy, positional balance). Fit + talent drive a
 * regular-season win projection; top-end talent + defense + fit drive a
 * playoff/championship projection. Everything is averaged over 15 years.
 */

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
const PROJECTION_YEARS = 15;

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * Position-aware skill weights. Guards aren't punished for thin rebounding and
 * bigs aren't punished for thin perimeter creation — each role is judged by what
 * it's asked to do.
 */
const POS_WEIGHTS = {
  PG: { scoring: 0.20, shooting: 0.16, playmaking: 0.22, rebounding: 0.03, perimeterD: 0.14, interiorD: 0.03, athleticism: 0.08, iq: 0.14 },
  SG: { scoring: 0.22, shooting: 0.18, playmaking: 0.12, rebounding: 0.05, perimeterD: 0.16, interiorD: 0.04, athleticism: 0.09, iq: 0.14 },
  SF: { scoring: 0.20, shooting: 0.15, playmaking: 0.12, rebounding: 0.08, perimeterD: 0.17, interiorD: 0.07, athleticism: 0.09, iq: 0.12 },
  PF: { scoring: 0.18, shooting: 0.12, playmaking: 0.10, rebounding: 0.14, perimeterD: 0.12, interiorD: 0.14, athleticism: 0.08, iq: 0.12 },
  C:  { scoring: 0.16, shooting: 0.08, playmaking: 0.12, rebounding: 0.16, perimeterD: 0.06, interiorD: 0.22, athleticism: 0.08, iq: 0.12 },
};

/**
 * Weighted overall rating from a player's skill profile, judged against their
 * primary position. A "star peak" bonus blends in a player's top skills so that
 * elite specialists are valued for what makes them great, not dragged to the
 * mean by their weaknesses.
 */
function playerOverall(player) {
  const r = player.ratings;
  const w = POS_WEIGHTS[player.pos] || POS_WEIGHTS.SF;
  let base = 0;
  for (const k in w) base += r[k] * w[k];

  // Reward elite peak ability (modern stars are deployed to maximize strengths).
  const top3 = Object.values(r).sort((a, b) => b - a).slice(0, 3);
  const top3avg = top3.reduce((s, v) => s + v, 0) / top3.length;

  return Math.round(base * 0.8 + top3avg * 0.2);
}

/**
 * Normalized career-shape curve. Returns a multiplier that peaks at 1.0 around
 * ages 27-28, ramps up through the early 20s, and decays through the 30s until
 * effective retirement in the early 40s.
 */
function careerShape(age) {
  const table = {
    18: 0.62, 19: 0.70, 20: 0.76, 21: 0.82, 22: 0.87, 23: 0.91, 24: 0.94,
    25: 0.97, 26: 0.99, 27: 1.00, 28: 1.00, 29: 0.98, 30: 0.95, 31: 0.92,
    32: 0.88, 33: 0.83, 34: 0.77, 35: 0.69, 36: 0.60, 37: 0.50, 38: 0.40,
    39: 0.30, 40: 0.20, 41: 0.12, 42: 0.05,
  };
  if (age < 18) return 0.55;
  if (age > 42) return 0;
  return table[age];
}

/**
 * Projected on-court value of a player at a given (future) age, before
 * availability is applied. Young, high-potential players are credited with
 * "anticipated" growth toward their ceiling.
 */
function seasonValue(player, age) {
  const overall = playerOverall(player);
  const baseNow = careerShape(player.age);
  if (baseNow <= 0) return 0;

  let v = overall * (careerShape(age) / baseNow);

  // Anticipated development for players still climbing toward their prime.
  if (age > player.age) {
    const yearsAhead = age - player.age;
    const growthWindow = Math.max(0, 28 - player.age); // seasons until prime
    if (growthWindow > 0 && yearsAhead <= growthWindow) {
      const upside = (player.potential / 100) * 0.22; // up to +22% at full bloom
      const ramp = yearsAhead / growthWindow;
      v *= 1 + upside * ramp;
    }
  }
  return clamp(v, 0, 99);
}

/**
 * Fraction of a season a player is expected to be available, given injury
 * history and age-related wear. 1.0 = iron man, lower = misses games.
 */
function availability(player, age) {
  const ageWear = Math.max(0, age - 31) * 1.6; // bodies break down later in life
  const effRisk = clamp(player.injuryRisk + ageWear, 0, 96);
  return clamp(1 - (effRisk / 100) * 0.55, 0.35, 1);
}

/** Availability-adjusted value for a single season. */
function effectiveSeasonValue(player, age) {
  return seasonValue(player, age) * availability(player, age);
}

// --------------------------------------------------------------------------
//  Roster helpers
// --------------------------------------------------------------------------

/** All non-null players on a roster (starters + bench). */
function rosterPlayers(roster) {
  const list = [];
  for (const pos of POSITIONS) if (roster.starters[pos]) list.push(roster.starters[pos]);
  for (const b of roster.bench) if (b) list.push(b);
  return list;
}

/** Starters as an array (skips empty slots). */
function starterPlayers(roster) {
  return POSITIONS.map((p) => roster.starters[p]).filter(Boolean);
}

// --------------------------------------------------------------------------
//  Team fit / chemistry  (evaluated for a given season using season values)
// --------------------------------------------------------------------------

/**
 * Chemistry score (0..100) for a lineup in a given season. Looks at how the
 * pieces fit, not just how good they are individually.
 */
function chemistryForSeason(starters, ages) {
  if (starters.length === 0) return 0;
  const r = (p) => p.ratings;

  // Weight each player's traits by how present they are this season (a faded
  // star contributes less to the chemistry picture).
  const n = starters.length;
  const avg = (sel) => starters.reduce((s, p) => s + sel(r(p)), 0) / n;

  const avgShooting = avg((x) => x.shooting);
  const avgPlaymaking = avg((x) => x.playmaking);
  const avgPerimD = avg((x) => x.perimeterD);
  const avgInteriorD = avg((x) => x.interiorD);
  const avgReb = avg((x) => x.rebounding);

  // --- Spacing: need enough floor-spacers; clogged spacing is a real penalty.
  const shooters = starters.filter((p) => r(p).shooting >= 74).length;
  let spacing = avgShooting;
  if (shooters >= 3) spacing += 8;
  else if (shooters <= 1) spacing -= 14;
  const nonShootingBigs = starters.filter(
    (p) => r(p).shooting < 55 && (p.eligible.includes("C") || p.eligible.includes("PF"))
  ).length;
  if (nonShootingBigs >= 2) spacing -= 12; // two non-spacing bigs cramp the paint

  // --- Playmaking: need at least one real engine; reward distributed passing.
  const hasEngine = starters.some((p) => r(p).playmaking >= 82);
  let playmaking = avgPlaymaking + (hasEngine ? 10 : -12);
  const ballDominant = starters.filter((p) => r(p).playmaking >= 86 && r(p).scoring >= 86).length;
  if (ballDominant >= 3) playmaking -= 8; // too many alphas need the same touches

  // --- Defense: blend perimeter + interior, demand a rim protector & a stopper.
  const hasRim = starters.some((p) => r(p).interiorD >= 82);
  const hasStopper = starters.some((p) => r(p).perimeterD >= 84);
  let defense = avgPerimD * 0.5 + avgInteriorD * 0.5;
  defense += (hasRim ? 7 : -10) + (hasStopper ? 6 : -6);

  // --- Rebounding: don't get killed on the glass.
  let rebounding = avgReb;
  if (avgReb < 60) rebounding -= 8;

  // --- Shot hierarchy: a clear go-to scorer matters, especially in spring.
  const goToScorers = starters.filter((p) => r(p).scoring >= 88).length;
  let hierarchy = 60;
  if (goToScorers >= 1) hierarchy += 18;
  if (goToScorers === 0) hierarchy -= 16;
  if (goToScorers >= 4) hierarchy -= 6; // not enough basketballs to go around

  const score =
    spacing * 0.22 +
    playmaking * 0.20 +
    defense * 0.26 +
    rebounding * 0.12 +
    hierarchy * 0.20;

  return clamp(score, 0, 100);
}

// --------------------------------------------------------------------------
//  Season + multi-year projection
// --------------------------------------------------------------------------

/** Map a blended team-strength (0..100) to a projected win total (out of 82). */
function strengthToWins(strength) {
  return clamp(9 + (strength - 40) * 1.25, 15, 73);
}

/**
 * Project a single season. Bench players cover for injured/aged-out starters by
 * lifting effective availability at each position.
 */
function projectSeason(roster, seasonIndex) {
  const starters = [];
  const ages = [];
  let starterValueSum = 0;
  let filledSlots = 0;

  // Bench depth pool for this season (best available reserves).
  const benchVals = roster.bench
    .filter(Boolean)
    .map((p) => ({ p, v: effectiveSeasonValue(p, p.age + seasonIndex) }))
    .sort((a, b) => b.v - a.v);
  let benchPtr = 0;

  for (const pos of POSITIONS) {
    const p = roster.starters[pos];
    if (!p) continue;
    filledSlots++;
    const age = p.age + seasonIndex;
    let val = effectiveSeasonValue(p, age);

    // If a starter has cratered (deep decline/retirement) a bench player on the
    // roster steps in for the lost production.
    if (benchPtr < benchVals.length && benchVals[benchPtr].v > val) {
      val = benchVals[benchPtr].v;
      benchPtr++;
    }
    starterValueSum += val;
    starters.push(p);
    ages.push(age);
  }

  if (filledSlots === 0) {
    return { wins: 15, playoffIndex: 0, titleProb: 0, avgStarterValue: 0, chemistry: 0 };
  }

  const avgStarterValue = starterValueSum / filledSlots;
  // Incomplete rosters are penalized — you can't compete with an empty slot.
  const completeness = filledSlots / POSITIONS.length;

  const chemistry = chemistryForSeason(starters, ages) * (0.6 + 0.4 * completeness);

  const strength = (avgStarterValue * 0.7 + chemistry * 0.3) * (0.55 + 0.45 * completeness);
  const wins = strengthToWins(strength);

  // Playoff strength leans on star power, defense and fit.
  const sortedVals = starters
    .map((p) => effectiveSeasonValue(p, p.age + seasonIndex))
    .sort((a, b) => b - a);
  const best = sortedVals[0] || 0;
  const top3 = sortedVals.slice(0, 3);
  const top3Avg = top3.reduce((s, v) => s + v, 0) / Math.max(1, top3.length);

  const playoffStrength =
    best * 0.42 + top3Avg * 0.28 + chemistry * 0.18 + avgStarterValue * 0.12;
  const playoffIndex = clamp((playoffStrength - 45) * 1.6, 0, 100) * completeness;

  // Rough championship probability for the season (logistic-ish on strength).
  const titleProb = clamp((playoffStrength - 78) / 38, 0, 1) ** 1.5 * completeness;

  return { wins, playoffIndex, titleProb, avgStarterValue, chemistry };
}

/**
 * Full 15-year evaluation of a roster. Returns aggregate metrics plus a season
 * timeline and a human-readable breakdown for the results screen.
 */
function evaluateRoster(roster) {
  const seasons = [];
  let winsSum = 0;
  let playoffSum = 0;
  let titlesExpected = 0;
  let peakWins = 0;

  for (let t = 0; t < PROJECTION_YEARS; t++) {
    const s = projectSeason(roster, t);
    seasons.push(s);
    winsSum += s.wins;
    playoffSum += s.playoffIndex;
    titlesExpected += s.titleProb;
    peakWins = Math.max(peakWins, s.wins);
  }

  const avgWins = winsSum / PROJECTION_YEARS;
  const avgPlayoffIndex = playoffSum / PROJECTION_YEARS;

  // Final composite: regular-season floor + playoff ceiling + dynasty bonus.
  const composite =
    avgWins * 0.6 + avgPlayoffIndex * 0.5 + titlesExpected * 14 + peakWins * 0.25;

  return {
    avgWins,
    avgRecord: `${avgWins.toFixed(1)}-${(82 - avgWins).toFixed(1)}`,
    peakWins: Math.round(peakWins),
    avgPlayoffIndex,
    titlesExpected,
    composite,
    seasons,
    breakdown: buildBreakdown(roster, seasons, avgWins, avgPlayoffIndex, titlesExpected),
  };
}

/** Translate a playoff index into a most-likely postseason result label. */
function playoffLabel(idx) {
  if (idx < 20) return "Miss playoffs";
  if (idx < 38) return "First round";
  if (idx < 55) return "Second round";
  if (idx < 70) return "Conference finals";
  if (idx < 84) return "NBA Finals";
  return "Championship favorite";
}

/** A few plain-English notes about a roster's strengths and flaws. */
function buildBreakdown(roster, seasons, avgWins, avgPlayoffIndex, titlesExpected) {
  const starters = starterPlayers(roster);
  const r = (p) => p.ratings;
  const notes = [];

  if (starters.length < POSITIONS.length) {
    notes.push(`⚠️ Incomplete starting five (${starters.length}/5 positions filled).`);
  }

  // Current-year snapshot of identity.
  const shooters = starters.filter((p) => r(p).shooting >= 74).length;
  if (shooters >= 3) notes.push("✅ Excellent floor spacing.");
  else if (shooters <= 1) notes.push("⚠️ Cramped spacing — not enough shooting.");

  if (starters.some((p) => r(p).interiorD >= 82)) notes.push("✅ Has a real rim protector.");
  else notes.push("⚠️ Soft interior defense — no rim protector.");

  if (starters.some((p) => r(p).playmaking >= 82)) notes.push("✅ Has a primary playmaking engine.");
  else notes.push("⚠️ No high-end creator to run the offense.");

  if (starters.some((p) => r(p).scoring >= 88)) notes.push("✅ Has a go-to bucket-getter for the playoffs.");
  else notes.push("⚠️ Lacks a true number-one scoring option.");

  const avgInjury = starters.reduce((s, p) => s + p.injuryRisk, 0) / Math.max(1, starters.length);
  if (avgInjury >= 55) notes.push("🩼 High injury risk across the core — durability is a concern.");
  else if (avgInjury <= 28) notes.push("💪 Very durable core — low injury risk.");

  const avgAge = starters.reduce((s, p) => s + p.age, 0) / Math.max(1, starters.length);
  if (avgAge <= 25) notes.push("🌱 Young core with years of anticipated growth ahead.");
  else if (avgAge >= 31) notes.push("⏳ Aging core — the 15-year window favors younger rosters.");

  notes.push(`🏆 Expected titles over 15 years: ${titlesExpected.toFixed(2)}.`);
  notes.push(`📅 Typical postseason result: ${playoffLabel(avgPlayoffIndex)}.`);

  return notes;
}

// --------------------------------------------------------------------------
//  Live draft helper: how good is this pick for THIS roster, right now?
// --------------------------------------------------------------------------

/**
 * A 0..100 "fit grade" for adding `player` to `roster` at `pos`, used to power
 * the draft-board recommendation hints. Combines the player's overall with how
 * much they shore up the roster's current weaknesses.
 */
function pickFitGrade(roster, player, pos) {
  const overall = playerOverall(player);
  const starters = starterPlayers(roster);
  const r = (p) => p.ratings;

  let need = 0;
  const hasShooting = starters.filter((p) => r(p).shooting >= 74).length >= 2;
  const hasRim = starters.some((p) => r(p).interiorD >= 82);
  const hasEngine = starters.some((p) => r(p).playmaking >= 82);
  const hasScorer = starters.some((p) => r(p).scoring >= 88);

  if (!hasShooting && player.ratings.shooting >= 74) need += 8;
  if (!hasRim && player.ratings.interiorD >= 82) need += 8;
  if (!hasEngine && player.ratings.playmaking >= 82) need += 8;
  if (!hasScorer && player.ratings.scoring >= 88) need += 8;

  const youth = clamp((30 - player.age) * 1.2, 0, 12); // reward long runway

  return clamp(overall * 0.7 + need + youth * 0.5, 0, 100);
}

// --------------------------------------------------------------------------
//  Exports
// --------------------------------------------------------------------------

const SCORING = {
  POSITIONS,
  PROJECTION_YEARS,
  playerOverall,
  seasonValue,
  availability,
  effectiveSeasonValue,
  evaluateRoster,
  playoffLabel,
  pickFitGrade,
  rosterPlayers,
  starterPlayers,
};

if (typeof module !== "undefined" && module.exports) module.exports = SCORING;
if (typeof window !== "undefined") window.SCORING = SCORING;
