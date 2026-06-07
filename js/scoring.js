/**
 * Analytics engine for the NBA Re-Draft game — CAREER edition.
 *
 * The premise: you draft players as rookies and keep them for a normalized
 * 15-season career. Every roster plays those 15 seasons together (everyone a
 * rookie in year 0, everyone aging in lockstep), and we estimate how the team
 * performs, then crown the most analytically sound *career* roster.
 *
 * A player's value each season comes from:
 *   1. PEAK ABILITY  - position-aware overall from the skill profile.
 *   2. CAREER ARC     - a rookie->year-15 curve shaped by `earlyImpact`
 *                       (great right away?) and `aging` (does the game age well?).
 *   3. DURABILITY     - injury risk is a career-long discount on availability.
 *
 * On top of that, INTANGIBLES shape both individual career value and team fit:
 *   winning, elevates (makes teammates better), ballDominance (alpha clash),
 *   culture (team cancer drag), coachability (system fit) — plus two-way
 *   defense and spacing, which live in the skill profile.
 */

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
const PROJECTION_YEARS = 15;

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Position-aware skill weights (guards judged on creation, bigs on the paint). */
const POS_WEIGHTS = {
  PG: { scoring: 0.20, shooting: 0.16, playmaking: 0.22, rebounding: 0.03, perimeterD: 0.14, interiorD: 0.03, athleticism: 0.08, iq: 0.14 },
  SG: { scoring: 0.22, shooting: 0.18, playmaking: 0.12, rebounding: 0.05, perimeterD: 0.16, interiorD: 0.04, athleticism: 0.09, iq: 0.14 },
  SF: { scoring: 0.20, shooting: 0.15, playmaking: 0.12, rebounding: 0.08, perimeterD: 0.17, interiorD: 0.07, athleticism: 0.09, iq: 0.12 },
  PF: { scoring: 0.18, shooting: 0.12, playmaking: 0.10, rebounding: 0.14, perimeterD: 0.12, interiorD: 0.14, athleticism: 0.08, iq: 0.12 },
  C:  { scoring: 0.16, shooting: 0.08, playmaking: 0.12, rebounding: 0.16, perimeterD: 0.06, interiorD: 0.22, athleticism: 0.08, iq: 0.12 },
};

/**
 * Career-PEAK overall (0..99): how good a player is at their best — i.e. how
 * good a centerpiece you'd be building around. We reward elite top-end skills
 * and on-ball shot creation (what separates a franchise #1 from a great role
 * player), so the scale puts inner-circle stars in the 90s.
 */
function peakOverall(player) {
  const r = player.ratings;
  const w = POS_WEIGHTS[player.pos] || POS_WEIGHTS.SF;
  let base = 0;
  for (const k in w) base += r[k] * w[k];

  const sorted = Object.values(r).sort((a, b) => b - a);
  const top3 = (sorted[0] + sorted[1] + sorted[2]) / 3;

  // "Can you be the #1 option?" — elite scoring/creation is the separator.
  const creation = r.scoring * 0.55 + r.playmaking * 0.25 + Math.max(r.shooting, r.scoring) * 0.20;

  const val = base * 0.45 + top3 * 0.30 + creation * 0.25;
  return Math.round(clamp(val, 0, 99));
}

/**
 * Generic rookie->year-15 development curve (career year t = 0..14), peaking in
 * the middle seasons. `earlyImpact` lifts the opening years; `aging` lifts (or,
 * below 50, sinks) the closing years.
 */
const ARC_BASE = [0.62, 0.74, 0.84, 0.92, 0.97, 1.0, 1.0, 0.99, 0.97, 0.94, 0.90, 0.86, 0.81, 0.75, 0.69];
const EARLY_W = [0.6, 0.42, 0.26, 0.12];
const LATE_W = [0, 0, 0, 0, 0, 0, 0, 0, 0.10, 0.16, 0.22, 0.28, 0.34, 0.40, 0.46];

function careerArc(t, earlyImpact, aging) {
  let v = ARC_BASE[t];
  if (t <= 3) v += (earlyImpact / 100) * (1 - v) * EARLY_W[t];
  if (t >= 8) v += ((aging - 50) / 50) * LATE_W[t];
  return clamp(v, 0.15, 1.06);
}

/**
 * Fraction of a career season a player is available. Injury risk is a *moderate*
 * discount, not a gutting: even fragile stars (Embiid, Kawhi, Klay) still give
 * you a lot of high-level basketball over a career — you'd still build around
 * them. This is a risk discount, not a season-by-season injury sim.
 */
function availability(player, t) {
  const base = 1 - (player.injuryRisk / 100) * 0.3;
  const lateWear = t >= 11 ? (t - 10) * 0.008 : 0;
  return clamp(base - lateWear, 0.5, 1);
}

/** Raw (pre-availability) value of a player in career season t. */
function seasonValue(player, t) {
  return peakOverall(player) * careerArc(t, player.career.earlyImpact, player.career.aging);
}

/** Availability-adjusted value in career season t. */
function effectiveSeasonValue(player, t) {
  return seasonValue(player, t) * availability(player, t);
}

/**
 * Headline CAREER rating (0..99) — "if you were building a team today around
 * this player's entire career, how valuable is he?"
 *
 * Talent (peak ability) dominates. A LONGEVITY term lightly rewards careers that
 * stay productive across the 15-year window (graceful aging + durability), and a
 * small INTANGIBLE nudge accounts for lifting teammates and winning. Injury and
 * winning are deliberately modest so a fragile former-MVP (Embiid) still rates
 * well above an excellent role player (Derrick White), and so inner-circle
 * talents land in the 90s.
 */
function careerRating(player) {
  const peak = peakOverall(player);

  // Average of the career arc (how much elite value across 15 seasons).
  let arcSum = 0;
  for (let t = 0; t < PROJECTION_YEARS; t++) {
    arcSum += careerArc(t, player.career.earlyImpact, player.career.aging);
  }
  const arcAvg = arcSum / PROJECTION_YEARS;
  const durability = 1 - (player.injuryRisk / 100) * 0.22; // gentle career haircut
  const longevity = arcAvg * durability; // ~0.6 .. 1.0

  const c = player.career;
  // Intangibles lean on teammate elevation (talent-adjacent); winning is a light touch.
  const intangibleNudge = (c.elevates - 75) / 14 + (c.winning - 75) / 40;

  const val = peak * 0.88 + peak * longevity * 0.12 + intangibleNudge;
  return clamp(Math.round(val), 0, 99);
}

// --------------------------------------------------------------------------
//  Roster helpers
// --------------------------------------------------------------------------

function rosterPlayers(roster) {
  const list = [];
  for (const pos of POSITIONS) if (roster.starters[pos]) list.push(roster.starters[pos]);
  for (const b of roster.bench) if (b) list.push(b);
  return list;
}

function starterPlayers(roster) {
  return POSITIONS.map((p) => roster.starters[p]).filter(Boolean);
}

// --------------------------------------------------------------------------
//  Team fit / chemistry
// --------------------------------------------------------------------------

/**
 * Chemistry score (0..100) for a lineup — how the pieces fit, blending on-court
 * fit (spacing, playmaking, defense, rebounding, shot hierarchy) with the human
 * factors (elevators, culture, coachability) and an alpha-clash penalty when too
 * many ball-dominant stars need the same touches.
 */
function chemistryForLineup(starters) {
  if (starters.length === 0) return 0;
  const r = (p) => p.ratings;
  const c = (p) => p.career;
  const n = starters.length;
  const avg = (sel) => starters.reduce((s, p) => s + sel(p), 0) / n;

  // --- On-court fit -------------------------------------------------------
  const avgShooting = avg((p) => r(p).shooting);
  const avgPlaymaking = avg((p) => r(p).playmaking);
  const avgPerimD = avg((p) => r(p).perimeterD);
  const avgInteriorD = avg((p) => r(p).interiorD);
  const avgReb = avg((p) => r(p).rebounding);

  const shooters = starters.filter((p) => r(p).shooting >= 74).length;
  let spacing = avgShooting + (shooters >= 3 ? 8 : shooters <= 1 ? -14 : 0);
  const nonShootingBigs = starters.filter(
    (p) => r(p).shooting < 55 && (p.eligible.includes("C") || p.eligible.includes("PF"))
  ).length;
  if (nonShootingBigs >= 2) spacing -= 12;

  const hasEngine = starters.some((p) => r(p).playmaking >= 82);
  let playmaking = avgPlaymaking + (hasEngine ? 10 : -12);

  const hasRim = starters.some((p) => r(p).interiorD >= 82);
  const hasStopper = starters.some((p) => r(p).perimeterD >= 84);
  let defense = avgPerimD * 0.5 + avgInteriorD * 0.5 + (hasRim ? 7 : -10) + (hasStopper ? 6 : -6);

  let rebounding = avgReb + (avgReb < 60 ? -8 : 0);

  const goToScorers = starters.filter((p) => r(p).scoring >= 88).length;
  let hierarchy = 60 + (goToScorers >= 1 ? 18 : -16) + (goToScorers >= 4 ? -6 : 0);

  const skillChem =
    spacing * 0.22 + playmaking * 0.20 + defense * 0.26 + rebounding * 0.12 + hierarchy * 0.20;

  // --- Human factors ------------------------------------------------------
  const avgElevates = avg((p) => c(p).elevates);
  const avgCulture = avg((p) => c(p).culture);
  const avgCoach = avg((p) => c(p).coachability);
  const humanChem = avgElevates * 0.4 + avgCulture * 0.35 + avgCoach * 0.25;

  // Alpha clash: stacking ball-dominant stars who all need the rock.
  const alphas = starters.filter((p) => c(p).ballDominance >= 85).length;
  const clashPenalty = alphas >= 3 ? 16 : alphas === 2 ? 7 : 0;

  // A team cancer poisons the room more than the averages suggest.
  const worstCulture = Math.min(...starters.map((p) => c(p).culture));
  const cancerPenalty = worstCulture < 45 ? (45 - worstCulture) * 0.4 : 0;

  const chem = skillChem * 0.66 + humanChem * 0.34 - clashPenalty - cancerPenalty;
  return clamp(chem, 0, 100);
}

// --------------------------------------------------------------------------
//  Season + multi-year projection
// --------------------------------------------------------------------------

function strengthToWins(strength) {
  return clamp(9 + (strength - 40) * 1.25, 15, 73);
}

/** Project a single career season (t). Bench depth covers faded/aged starters. */
function projectSeason(roster, t) {
  const starters = [];
  let starterValueSum = 0;
  let filledSlots = 0;

  const benchVals = roster.bench
    .filter(Boolean)
    .map((p) => ({ p, v: effectiveSeasonValue(p, t) }))
    .sort((a, b) => b.v - a.v);
  let benchPtr = 0;

  for (const pos of POSITIONS) {
    const p = roster.starters[pos];
    if (!p) continue;
    filledSlots++;
    let val = effectiveSeasonValue(p, t);
    if (benchPtr < benchVals.length && benchVals[benchPtr].v > val) {
      val = benchVals[benchPtr].v;
      benchPtr++;
    }
    starterValueSum += val;
    starters.push(p);
  }

  if (filledSlots === 0) {
    return { wins: 15, playoffIndex: 0, titleProb: 0, avgStarterValue: 0, chemistry: 0 };
  }

  const avgStarterValue = starterValueSum / filledSlots;
  const completeness = filledSlots / POSITIONS.length;
  const chemistry = chemistryForLineup(starters) * (0.6 + 0.4 * completeness);

  // Elevators make the whole greater than the sum of parts.
  const avgElevates = starters.reduce((s, p) => s + p.career.elevates, 0) / filledSlots;
  const elevateBoost = (avgElevates - 70) * 0.06;

  const strength =
    (avgStarterValue * 0.7 + chemistry * 0.3 + elevateBoost) * (0.55 + 0.45 * completeness);
  const wins = strengthToWins(strength);

  // Playoffs reward star power, defense, fit and proven winners.
  const sortedVals = starters.map((p) => effectiveSeasonValue(p, t)).sort((a, b) => b - a);
  const best = sortedVals[0] || 0;
  const top3 = sortedVals.slice(0, 3);
  const top3Avg = top3.reduce((s, v) => s + v, 0) / Math.max(1, top3.length);
  const avgWinning = starters.reduce((s, p) => s + p.career.winning, 0) / filledSlots;

  const playoffStrength =
    best * 0.40 + top3Avg * 0.27 + chemistry * 0.17 + avgStarterValue * 0.10 + avgWinning * 0.06;
  const playoffIndex = clamp((playoffStrength - 45) * 1.6, 0, 100) * completeness;
  const titleProb = clamp((playoffStrength - 78) / 38, 0, 1) ** 1.5 * completeness;

  return { wins, playoffIndex, titleProb, avgStarterValue, chemistry };
}

/** Full 15-season evaluation of a roster. */
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
    breakdown: buildBreakdown(roster, avgPlayoffIndex, titlesExpected),
  };
}

function playoffLabel(idx) {
  if (idx < 20) return "Miss playoffs";
  if (idx < 38) return "First round";
  if (idx < 55) return "Second round";
  if (idx < 70) return "Conference finals";
  if (idx < 84) return "NBA Finals";
  return "Championship favorite";
}

function buildBreakdown(roster, avgPlayoffIndex, titlesExpected) {
  const starters = starterPlayers(roster);
  const r = (p) => p.ratings;
  const c = (p) => p.career;
  const notes = [];

  if (starters.length < POSITIONS.length) {
    notes.push(`⚠️ Incomplete starting five (${starters.length}/5 positions filled).`);
  }

  const shooters = starters.filter((p) => r(p).shooting >= 74).length;
  if (shooters >= 3) notes.push("✅ Excellent floor spacing.");
  else if (shooters <= 1) notes.push("⚠️ Cramped spacing — not enough shooting.");

  if (starters.some((p) => r(p).interiorD >= 82)) notes.push("✅ Has a real rim protector.");
  else notes.push("⚠️ Soft interior defense — no rim protector.");

  if (starters.some((p) => r(p).playmaking >= 82)) notes.push("✅ Has a primary playmaking engine.");
  else notes.push("⚠️ No high-end creator to run the offense.");

  if (starters.some((p) => r(p).scoring >= 88)) notes.push("✅ Has a go-to bucket-getter for the playoffs.");
  else notes.push("⚠️ Lacks a true number-one scoring option.");

  const alphas = starters.filter((p) => c(p).ballDominance >= 85).length;
  if (alphas >= 2) notes.push(`⚠️ ${alphas} ball-dominant alphas — touches may clash.`);

  const avgElevates = starters.reduce((s, p) => s + c(p).elevates, 0) / Math.max(1, starters.length);
  if (avgElevates >= 84) notes.push("✅ Roster full of teammate-elevators — plays bigger than the sum of its parts.");

  const worstCulture = starters.length ? Math.min(...starters.map((p) => c(p).culture)) : 100;
  if (worstCulture < 45) notes.push("☣️ Locker-room risk — a potential team cancer in the mix.");
  else if (starters.every((p) => c(p).culture >= 82)) notes.push("🤝 Strong culture and coachability throughout.");

  const avgInjury = starters.reduce((s, p) => s + p.injuryRisk, 0) / Math.max(1, starters.length);
  if (avgInjury >= 55) notes.push("🩼 High injury risk across the core — availability is a real concern.");
  else if (avgInjury <= 28) notes.push("💪 Very durable core — low injury risk.");

  const avgAging = starters.reduce((s, p) => s + c(p).aging, 0) / Math.max(1, starters.length);
  if (avgAging >= 82) notes.push("🍷 Games that age gracefully — sustained value deep into the 15-year window.");
  else if (avgAging <= 65) notes.push("⏳ Athleticism-reliant core — values fade in the back half of the window.");

  const avgWinning = starters.reduce((s, p) => s + c(p).winning, 0) / Math.max(1, starters.length);
  if (avgWinning >= 85) notes.push("🏆 Proven winners — this group rises in the postseason.");

  notes.push(`🏆 Expected titles over 15 years: ${titlesExpected.toFixed(2)}.`);
  notes.push(`📅 Typical postseason result: ${playoffLabel(avgPlayoffIndex)}.`);

  return notes;
}

// --------------------------------------------------------------------------
//  Live draft helper
// --------------------------------------------------------------------------

/**
 * FIT (0..100) — "how much does drafting this player help THIS roster right now?"
 *
 * It starts from the player's career rating and adds bonuses for filling the
 * roster's current gaps (shooting, rim protection, playmaking, a #1 scorer,
 * and an open position), minus penalties for stacking ball-dominant alphas or
 * adding a locker-room risk. Because it's capped at 100, an elite player on an
 * empty roster (every need open) reads as a perfect ~100 fit; as the roster
 * fills and needs disappear, the same player's fit naturally settles toward his
 * raw rating. A redundant or clashing addition drops below it.
 */
function pickFitGrade(roster, player, pos) {
  const career = careerRating(player);
  const starters = starterPlayers(roster);
  const r = (p) => p.ratings;
  const c = (p) => p.career;

  let need = 0;
  const hasShooting = starters.filter((p) => r(p).shooting >= 74).length >= 2;
  const hasRim = starters.some((p) => r(p).interiorD >= 82);
  const hasEngine = starters.some((p) => r(p).playmaking >= 82);
  const hasScorer = starters.some((p) => r(p).scoring >= 88);

  if (!hasShooting && player.ratings.shooting >= 74) need += 5;
  if (!hasRim && player.ratings.interiorD >= 82) need += 5;
  if (!hasEngine && player.ratings.playmaking >= 82) need += 5;
  if (!hasScorer && player.ratings.scoring >= 88) need += 5;
  // Filling a still-open starting position is itself valuable.
  if (pos && pos !== "BENCH" && !roster.starters[pos]) need += 6;

  // Penalize stacking another alpha when an alpha is already aboard.
  const alphas = starters.filter((p) => c(p).ballDominance >= 85).length;
  const alphaPenalty = alphas >= 1 && c(player).ballDominance >= 85 ? 6 : 0;

  // Slight penalty for adding a locker-room risk to an existing group.
  const culturePenalty =
    starters.length > 0 && c(player).culture < 50 ? (50 - c(player).culture) * 0.12 : 0;

  return clamp(career + need - alphaPenalty - culturePenalty, 0, 100);
}

// --------------------------------------------------------------------------
//  Team-needs analysis (powers the live "what does my team need?" panel)
// --------------------------------------------------------------------------

/**
 * Inspect a roster's starters and report which team-building boxes are checked
 * and which are still open, so a drafter knows what to target next.
 * Returns { strengths, gaps, openPositions, items } where each item is
 * { key, label, present, have, miss, priority } (lower priority = more urgent).
 */
function analyzeRoster(roster) {
  const s = starterPlayers(roster);
  const r = (p) => p.ratings;
  const first = (arr) => (arr.length ? arr[0].name : "");

  const scorers = s.filter((p) => r(p).scoring >= 88);
  const shooters = s.filter((p) => r(p).shooting >= 74);
  const engines = s.filter((p) => r(p).playmaking >= 82);
  const rim = s.filter((p) => r(p).interiorD >= 82);
  const stoppers = s.filter((p) => r(p).perimeterD >= 84);
  const boards = s.filter((p) => r(p).rebounding >= 80);

  const items = [
    { key: "creation", label: "#1 scoring option", present: scorers.length >= 1, priority: 1,
      have: `${first(scorers)} can be your go-to scorer`,
      miss: "No true number-one scorer for crunch time" },
    { key: "rim", label: "Rim protection", present: rim.length >= 1, priority: 1,
      have: `${first(rim)} anchors the paint`,
      miss: "No rim protector — vulnerable at the basket" },
    { key: "spacing", label: "Floor spacing", present: shooters.length >= 2, priority: 2,
      have: `${shooters.length} reliable shooter${shooters.length === 1 ? "" : "s"}`,
      miss: "Cramped spacing — needs more shooting" },
    { key: "playmaking", label: "Primary playmaker", present: engines.length >= 1, priority: 2,
      have: `${first(engines)} runs the offense`,
      miss: "No high-end creator to set up teammates" },
    { key: "perimeterD", label: "Perimeter defense", present: stoppers.length >= 1, priority: 3,
      have: `${first(stoppers)} can guard the other team's best wing`,
      miss: "No point-of-attack stopper on the perimeter" },
    { key: "rebounding", label: "Rebounding", present: boards.length >= 1, priority: 3,
      have: `${first(boards)} cleans the glass`,
      miss: "Thin on the glass" },
  ];

  return {
    strengths: items.filter((i) => i.present),
    gaps: items.filter((i) => !i.present),
    openPositions: POSITIONS.filter((pos) => !roster.starters[pos]),
    items,
  };
}

/** Which analysis gaps would `player` help address? Returns array of keys. */
function traitsProvided(player) {
  const r = player.ratings;
  const out = [];
  if (r.scoring >= 88) out.push("creation");
  if (r.interiorD >= 82) out.push("rim");
  if (r.shooting >= 74) out.push("spacing");
  if (r.playmaking >= 82) out.push("playmaking");
  if (r.perimeterD >= 84) out.push("perimeterD");
  if (r.rebounding >= 80) out.push("rebounding");
  return out;
}

// --------------------------------------------------------------------------
//  Exports
// --------------------------------------------------------------------------

const SCORING = {
  POSITIONS,
  PROJECTION_YEARS,
  peakOverall,
  careerRating,
  seasonValue,
  availability,
  effectiveSeasonValue,
  careerArc,
  evaluateRoster,
  playoffLabel,
  pickFitGrade,
  analyzeRoster,
  traitsProvided,
  rosterPlayers,
  starterPlayers,
  // Back-compat alias: the UI's "overall" badge now shows the career rating.
  playerOverall: careerRating,
};

if (typeof module !== "undefined" && module.exports) module.exports = SCORING;
if (typeof window !== "undefined") window.SCORING = SCORING;
