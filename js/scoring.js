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

  // Two-way credit: shutdown perimeter D, steals and rim-protecting blocks add
  // a little value on top (a small, centered bonus so it doesn't distort scale).
  const e = player.ext || {};
  const defScore =
    r.perimeterD * 0.3 + r.interiorD * 0.3 +
    (e.steals != null ? e.steals : r.perimeterD) * 0.2 +
    (e.blocks != null ? e.blocks : r.interiorD) * 0.2;
  const defBonus = (defScore - 70) * 0.06;

  const val = base * 0.45 + top3 * 0.30 + creation * 0.25 + defBonus;
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
  const e = player.ext || {};
  // Intangibles lean on teammate elevation (talent-adjacent); winning and clutch
  // are light touches.
  const intangibleNudge =
    (c.elevates - 75) / 14 + (c.winning - 75) / 40 + ((e.clutch != null ? e.clutch : 70) - 75) / 40;

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
//  Advanced metrics: usage / shot distribution
// --------------------------------------------------------------------------

/**
 * `ballDominance` is our proxy for usage rate — how much a player needs the ball
 * to be effective. A label for the UI.
 */
function usageTier(player) {
  const u = player.career.ballDominance;
  if (u >= 88) return "High usage";
  if (u >= 72) return "Secondary";
  if (u >= 55) return "Low usage";
  return "Off-ball";
}

/**
 * Offensive balance (0..100) — how well a lineup's usage/shot distribution fits
 * together. There's only one ball: you want one or two high-usage creators (at
 * least one true initiator), surrounded by lower-usage, off-ball shooters.
 * Stacking three-plus ball-dominant scorers is a usage logjam.
 */
function offensiveBalance(starters) {
  if (starters.length === 0) return 50;
  const r = (p) => p.ratings;
  const c = (p) => p.career;
  const u = starters.map((p) => c(p).ballDominance);

  const creators = starters.filter((p) => c(p).ballDominance >= 80).length;
  const initiators = starters.filter(
    (p) => c(p).ballDominance >= 72 && r(p).playmaking >= 80
  ).length;
  const offBallShooters = starters.filter(
    (p) => c(p).ballDominance <= 62 && r(p).shooting >= 74
  ).length;

  let score = 70;
  if (creators >= 1 || initiators >= 1) score += 8;
  else score -= 16; // no one who can create offense

  if (creators === 2) score += 4; // a healthy 1-2 punch
  if (creators === 3) score -= 12; // logjam
  if (creators >= 4) score -= 22;

  score += Math.min(offBallShooters, 3) * 4; // complementary spacers

  const avgU = u.reduce((a, b) => a + b, 0) / u.length;
  if (avgU >= 78) score -= (avgU - 78) * 1.3; // too many mouths to feed

  return clamp(score, 0, 100);
}

/** Safe accessor for the derived advanced attributes. */
const ext = (p) => p.ext || {};

/**
 * Pairwise synergy between two teammates — the heart of roster-construction
 * modeling. Returns { off, def, offReason, defReason } where off/def are point
 * adjustments (positive = they make each other better, negative = worse).
 *
 * Offense: two ball-dominant iso creators step on each other (Luka + Harden);
 * two paint-bound bigs clog the post/lane (Giannis + Embiid); a creator paired
 * with a spacer, lob threat, or shooter lifts both. Defense: a rim protector
 * plus a perimeter stopper covers all levels; twin shot-blockers wall the paint;
 * two weak defenders can be hunted.
 */
function pairSynergy(a, b) {
  const ra = a.ratings, rb = b.ratings;
  const ca = a.career, cb = b.career;
  const ea = ext(a), eb = ext(b);
  let off = 0, def = 0, offReason = "", defReason = "";

  // Rim-protection level combines shot-blocking and interior defense.
  const aRim = Math.max(ea.blocks || 0, ra.interiorD);
  const bRim = Math.max(eb.blocks || 0, rb.interiorD);

  // --- OFFENSE ---
  if (ca.ballDominance >= 80 && cb.ballDominance >= 80) {
    off -= ((ca.ballDominance - 80) + (cb.ballDominance - 80)) * 0.18 + 3;
    offReason = "both need the ball in iso to create";
  }
  if (ea.interiorLoad >= 72 && eb.interiorLoad >= 72) {
    off -= ((ea.interiorLoad - 72) + (eb.interiorLoad - 72)) * 0.15 + 3;
    offReason = "both operate out of the paint/post — clogged spacing";
  }
  const aIsCreator = ra.playmaking >= rb.playmaking;
  const hiPlay = Math.max(ra.playmaking, rb.playmaking);
  const spacerShoot = aIsCreator ? rb.shooting : ra.shooting;
  const spacerLoad = aIsCreator ? eb.interiorLoad : ea.interiorLoad;
  if (hiPlay >= 82 && spacerShoot >= 80) {
    off += 4; if (!offReason) offReason = "creator paired with a floor-spacer";
  }
  if (hiPlay >= 84 && spacerLoad >= 72) {
    off += 3; if (!offReason) offReason = "creator paired with a lob/roll finisher";
  }
  if ((ea.interiorLoad >= 72 && rb.shooting >= 80) || (eb.interiorLoad >= 72 && ra.shooting >= 80)) {
    off += 3; if (!offReason) offReason = "shooting spaces the floor for a paint scorer";
  }
  if (ra.shooting < 55 && rb.shooting < 55) {
    off -= 5; offReason = "neither spaces the floor";
  }

  // --- DEFENSE ---
  if ((bRim >= 82 && ra.perimeterD >= 84) || (aRim >= 82 && rb.perimeterD >= 84)) {
    def += 5; defReason = "rim protector + perimeter stopper covers all levels";
  }
  if (aRim >= 80 && bRim >= 80) {
    def += 4; if (!defReason) defReason = "twin rim protectors wall off the paint";
  }
  if (ea.steals >= 72 && eb.steals >= 72) {
    def += 3; if (!defReason) defReason = "both generate steals and ball pressure";
  }
  if (ra.perimeterD >= 84 && rb.perimeterD >= 84) {
    def += 3; if (!defReason) defReason = "two switchable perimeter stoppers";
  }
  if (ra.perimeterD < 58 && rb.perimeterD < 58 && ea.blocks < 60 && eb.blocks < 60) {
    def -= 6; defReason = "two weak defenders can be hunted";
  }

  return { off, def, offReason, defReason };
}

/** Sum pairwise synergy across a lineup; returns { off, def, pairs }. */
function teamSynergy(starters) {
  let off = 0, def = 0;
  const pairs = [];
  for (let i = 0; i < starters.length; i++) {
    for (let j = i + 1; j < starters.length; j++) {
      const s = pairSynergy(starters[i], starters[j]);
      off += s.off;
      def += s.def;
      pairs.push({ a: starters[i], b: starters[j], ...s });
    }
  }
  return { off, def, pairs };
}

/** Human-readable notes about the most notable teammate pairings. */
function synergyNotes(roster) {
  const starters = starterPlayers(roster);
  const { pairs } = teamSynergy(starters);
  const notes = [];
  pairs.forEach((p) => {
    if (p.off <= -6) notes.push({ mag: -p.off, kind: "bad", text: `🅾️ ${p.a.name} & ${p.b.name} clash on offense — ${p.offReason}.` });
    else if (p.off >= 5) notes.push({ mag: p.off, kind: "good", text: `🅾️ ${p.a.name} & ${p.b.name} mesh on offense — ${p.offReason}.` });
    if (p.def >= 4) notes.push({ mag: p.def, kind: "good", text: `🛡️ ${p.a.name} & ${p.b.name} — ${p.defReason}.` });
    else if (p.def <= -5) notes.push({ mag: -p.def, kind: "bad", text: `🛡️ ${p.a.name} & ${p.b.name} — ${p.defReason}.` });
  });
  // Most impactful pairings first.
  return notes.sort((a, b) => b.mag - a.mag).slice(0, 7);
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

  const avgSteals = avg((p) => ext(p).steals != null ? ext(p).steals : r(p).perimeterD);
  const avgBlocks = avg((p) => ext(p).blocks != null ? ext(p).blocks : r(p).interiorD);
  const hasRim = starters.some((p) => r(p).interiorD >= 82 || ext(p).blocks >= 82);
  const hasStopper = starters.some((p) => r(p).perimeterD >= 84 || ext(p).steals >= 80);
  let defense =
    avgPerimD * 0.3 + avgInteriorD * 0.28 + avgSteals * 0.2 + avgBlocks * 0.22 +
    (hasRim ? 7 : -10) + (hasStopper ? 6 : -6);

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

  // Usage / shot-distribution fit (the advanced-stats lens on chemistry).
  const offBalance = offensiveBalance(starters);

  // Pairwise roster-construction synergy: how the specific players fit together.
  const syn = teamSynergy(starters);
  const synAdj = clamp(syn.off, -18, 14) * 0.5 + clamp(syn.def, -12, 18) * 0.5;

  // A team cancer poisons the room more than the averages suggest.
  const worstCulture = Math.min(...starters.map((p) => c(p).culture));
  const cancerPenalty = worstCulture < 45 ? (45 - worstCulture) * 0.4 : 0;

  const chem = skillChem * 0.55 + humanChem * 0.25 + offBalance * 0.12 + 8 + synAdj - cancerPenalty;
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
  const avgClutch = starters.reduce((s, p) => s + (ext(p).clutch != null ? ext(p).clutch : 70), 0) / filledSlots;

  // Playoffs reward star power, defense, fit, proven winners AND clutch — so a
  // clutch, playoff-built team can win titles beyond what its record suggests.
  const playoffStrength =
    best * 0.38 + top3Avg * 0.25 + chemistry * 0.16 + avgStarterValue * 0.08 +
    avgWinning * 0.06 + avgClutch * 0.07;
  const playoffIndex = clamp((playoffStrength - 45) * 1.6, 0, 100) * completeness;

  // Per-season championship probability (capped); summed over 15 years this lands
  // a dynasty around 3-5 titles, a contender ~1-2, a pretender ~0.
  const titleProb = clamp((playoffStrength - 72) / 22, 0, 1) ** 1.6 * 0.55 * completeness;

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
  const pk = Math.round(peakWins);
  const championships = Math.round(titlesExpected);
  const composite =
    avgWins * 0.55 + avgPlayoffIndex * 0.5 + titlesExpected * 4.5 + peakWins * 0.25;

  return {
    avgWins,
    avgRecord: `${avgWins.toFixed(1)}-${(82 - avgWins).toFixed(1)}`,
    peakWins: pk,
    bestRecord: `${pk}-${82 - pk}`, // best single-season record at peak
    avgPlayoffIndex,
    titlesExpected, // expected value (fractional)
    championships, // rounded total titles over 15 years
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

  const creators = starters.filter((p) => c(p).ballDominance >= 80).length;
  const offBall = starters.filter((p) => c(p).ballDominance <= 62 && r(p).shooting >= 74).length;
  if (creators >= 3) notes.push(`⚠️ Usage logjam — ${creators} ball-dominant scorers competing for one ball.`);
  else if (creators >= 1 && offBall >= 2) notes.push("✅ Balanced shot distribution — creators surrounded by off-ball shooters.");
  else if (creators === 0) notes.push("⚠️ No high-usage shot creator to generate offense.");

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

  const avgClutch = starters.reduce((s, p) => s + (ext(p).clutch || 70), 0) / Math.max(1, starters.length);
  if (avgClutch >= 85) notes.push("🧊 Ice in their veins — elite clutch shot-making for tight playoff games.");
  else if (avgClutch <= 62) notes.push("😬 Questionable in the clutch — may shrink in close games.");

  const avgSteals = starters.reduce((s, p) => s + (ext(p).steals || 40), 0) / Math.max(1, starters.length);
  const avgBlocks = starters.reduce((s, p) => s + (ext(p).blocks || 40), 0) / Math.max(1, starters.length);
  if ((avgSteals + avgBlocks) / 2 >= 68) notes.push("🦅 Disruptive, event-creating defense (steals + blocks).");

  // Notable teammate pairings (roster construction).
  synergyNotes(roster).forEach((s) => notes.push(s.text));

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

  // Usage / shot-distribution fit: you need a creator, but stacking ball-
  // dominant scorers is a logjam, while off-ball shooters complement them.
  const curCreators = starters.filter((p) => c(p).ballDominance >= 80).length;
  let usageAdj = 0;
  if (c(player).ballDominance >= 80) {
    if (curCreators === 0) usageAdj += 3; // you need someone to create
    else if (curCreators === 1) usageAdj -= 2;
    else usageAdj -= 8; // usage logjam
  } else if (curCreators >= 1 && c(player).ballDominance <= 62 && player.ratings.shooting >= 72) {
    usageAdj += 4; // off-ball spacer next to your creators
  }

  // Pairwise synergy with the players already on the roster: does this pick make
  // the current group better or worse (and vice versa)?
  let synFit = 0;
  for (const mate of starters) {
    const s = pairSynergy(player, mate);
    synFit += s.off + s.def;
  }
  synFit = clamp(synFit, -14, 12) * 0.5;

  // A little extra value for proven clutch closers.
  const clutchFit = ((ext(player).clutch != null ? ext(player).clutch : 70) - 72) * 0.04;

  // Slight penalty for adding a locker-room risk to an existing group.
  const culturePenalty =
    starters.length > 0 && c(player).culture < 50 ? (50 - c(player).culture) * 0.12 : 0;

  return clamp(career + need + usageAdj + synFit + clutchFit - culturePenalty, 0, 100);
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

/**
 * Concise strengths & weaknesses for the results page. Returns
 * { strengths: string[], weaknesses: string[] } — short, plain-English phrases
 * spanning talent, fit, usage balance, durability, aging and intangibles.
 */
function teamStrengthsWeaknesses(roster) {
  const s = starterPlayers(roster);
  const r = (p) => p.ratings;
  const c = (p) => p.career;
  const strengths = [];
  const weaknesses = [];
  if (s.length === 0) return { strengths, weaknesses };

  const avg = (sel) => s.reduce((a, p) => a + sel(p), 0) / s.length;
  const a = analyzeRoster(roster);

  // On-court identity (from the shared analyzer).
  const LABEL = {
    creation: "go-to shot creation", rim: "rim protection", spacing: "floor spacing",
    playmaking: "high-end playmaking", perimeterD: "perimeter defense", rebounding: "rebounding",
  };
  a.strengths.forEach((i) => strengths.push(LABEL[i.key]));
  a.gaps.forEach((i) => weaknesses.push("lacks " + LABEL[i.key]));

  // Usage / shot distribution.
  const creators = s.filter((p) => c(p).ballDominance >= 80).length;
  const offBall = s.filter((p) => c(p).ballDominance <= 62 && r(p).shooting >= 74).length;
  if (creators >= 1 && offBall >= 2) strengths.push("balanced usage / shot distribution");
  if (creators >= 3) weaknesses.push("usage logjam (too many ball-dominant scorers)");

  // Defense overall (incl. event-creating steals & blocks).
  const def = avg((p) => (r(p).perimeterD + r(p).interiorD + (ext(p).steals || 40) + (ext(p).blocks || 40)) / 4);
  if (def >= 74) strengths.push("elite, event-creating two-way defense");
  else if (def <= 56) weaknesses.push("leaky defense");

  // Clutch.
  const clutch = avg((p) => ext(p).clutch || 70);
  if (clutch >= 85) strengths.push("elite clutch shot-making");
  else if (clutch <= 62) weaknesses.push("shaky in the clutch");

  // Roster-construction synergy.
  const syn = teamSynergy(s);
  if (syn.off <= -8) weaknesses.push("clashing offensive fits (overlapping creators/paint scorers)");
  else if (syn.off >= 8) strengths.push("complementary offensive fits");
  if (syn.def >= 10) strengths.push("layered, complementary defense");

  // Durability / aging / intangibles.
  const avgInjury = avg((p) => p.injuryRisk);
  if (avgInjury <= 30) strengths.push("durable, low-injury core");
  else if (avgInjury >= 55) weaknesses.push("high injury risk");

  const avgAging = avg((p) => c(p).aging);
  if (avgAging >= 82) strengths.push("ages gracefully across the window");
  else if (avgAging <= 65) weaknesses.push("athleticism-reliant, fades late");

  if (avg((p) => c(p).winning) >= 85) strengths.push("proven playoff winners");
  if (avg((p) => c(p).elevates) >= 85) strengths.push("teammate-elevators");
  const worstCulture = Math.min(...s.map((p) => c(p).culture));
  if (worstCulture < 45) weaknesses.push("locker-room risk");

  return { strengths, weaknesses };
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
  teamStrengthsWeaknesses,
  usageTier,
  offensiveBalance,
  pairSynergy,
  teamSynergy,
  synergyNotes,
  rosterPlayers,
  starterPlayers,
  // Back-compat alias: the UI's "overall" badge now shows the career rating.
  playerOverall: careerRating,
};

if (typeof module !== "undefined" && module.exports) module.exports = SCORING;
if (typeof window !== "undefined") window.SCORING = SCORING;
