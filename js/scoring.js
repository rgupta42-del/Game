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
 * Per-player memoization. Career ratings, peak ratings and dominance depend only
 * on a player's (static) profile, but are read constantly while rendering the
 * board, sorting and projecting rosters. Caching them by player id turns a lot
 * of repeated O(15)/O(8) work into a single lookup.
 */
const _peakCache = new Map();
const _careerCache = new Map();
const _domCache = new Map();

/**
 * Career-PEAK overall (0..99): how good a player is at their best — i.e. how
 * good a centerpiece you'd be building around. We reward elite top-end skills
 * and on-ball shot creation (what separates a franchise #1 from a great role
 * player), so the scale puts inner-circle stars in the 90s.
 */
function peakOverall(player) {
  const cached = _peakCache.get(player.id);
  if (cached !== undefined) return cached;
  const r = player.ratings;
  const w = POS_WEIGHTS[player.pos] || POS_WEIGHTS.SF;
  let base = 0;
  for (const k in w) base += r[k] * w[k];

  const sorted = Object.values(r).sort((a, b) => b - a);
  const top3 = (sorted[0] + sorted[1] + sorted[2]) / 3;

  // "Can you be the #1 option?" — elite scoring/creation is one separator...
  const creation = r.scoring * 0.55 + r.playmaking * 0.25 + Math.max(r.shooting, r.scoring) * 0.20;

  // ...but two-way ability is talent too. Shutdown perimeter D, steals and
  // rim-protecting blocks are a real component of how good a player is, so a
  // one-way scorer has a lower ceiling than an equally-skilled two-way player.
  const e = player.ext || {};
  const defComposite =
    (r.perimeterD + r.interiorD + (e.steals != null ? e.steals : r.perimeterD) +
      (e.blocks != null ? e.blocks : r.interiorD)) / 4;

  const val = base * 0.38 + top3 * 0.23 + creation * 0.25 + defComposite * 0.14;
  const result = Math.round(clamp(val, 0, 99));
  _peakCache.set(player.id, result);
  return result;
}

/**
 * DOMINANCE (0..~100) — can this player be the best player on the floor / the
 * engine a contender is built around? It rewards efficient primary shot creation
 * (volume scoring + on-ball creation + playmaking, scaled by scoring efficiency),
 * which is what separates a dominant alpha from an ancillary/secondary piece. A
 * high-volume but inefficient scorer (Trae) does NOT read as dominant.
 */
function dominance(player) {
  const cached = _domCache.get(player.id);
  if (cached !== undefined) return cached;
  const r = player.ratings;
  const e = player.ext || {};
  const creation = r.scoring * 0.55 + r.playmaking * 0.25 + Math.max(r.shooting, r.scoring) * 0.20;
  const primaryImpact = r.scoring * 0.45 + creation * 0.35 + r.playmaking * 0.20;
  const eff = e.efficiency != null ? e.efficiency : 70;
  const effMult = clamp(0.82 + (eff - 70) / 90, 0.78, 1.05);
  const result = primaryImpact * effMult;
  _domCache.set(player.id, result);
  return result;
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
  // Big men break down faster as a career wears on (knees, feet, back), so they
  // lose more availability in the back half of the 15-year window.
  const isBig = player.pos === "C" || player.pos === "PF";
  const lateWear = t >= 9 ? (t - 8) * (isBig ? 0.014 : 0.008) : 0;
  return clamp(base - lateWear, 0.45, 1);
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
  const cached = _careerCache.get(player.id);
  if (cached !== undefined) return cached;
  const peak = peakOverall(player);

  // Average of the career arc (how much elite value across 15 seasons).
  let arcSum = 0;
  for (let t = 0; t < PROJECTION_YEARS; t++) {
    arcSum += careerArc(t, player.career.earlyImpact, player.career.aging);
  }
  const arcAvg = arcSum / PROJECTION_YEARS;
  const durability = 1 - (player.injuryRisk / 100) * 0.22; // gentle career haircut
  const longevity = arcAvg * durability; // ~0.6 .. 1.0

  const r = player.ratings;
  const c = player.career;
  const e = player.ext || {};
  const defComposite =
    (r.perimeterD + r.interiorD + (e.steals != null ? e.steals : r.perimeterD) +
      (e.blocks != null ? e.blocks : r.interiorD)) / 4;

  // A player's career value is dominated by talent, but lifted by floor-raising
  // (elevates) and by being a two-way winner who shows up in big moments
  // (winning + clutch + defense). This separates proven two-way winners from
  // empty-stats, one-way, non-clutch ball-handlers.
  const twoWayWinning = c.winning * 0.45 + (e.clutch != null ? e.clutch : 70) * 0.25 + defComposite * 0.30;

  // Efficiency matters: inefficient, turnover-prone volume scorers (Trae,
  // LaMelo) get docked; efficient, careful creators (Curry, CP3) get a boost.
  const eff = e.efficiency != null ? e.efficiency : 70;
  const tov = e.turnovers != null ? e.turnovers : 42;
  const efficiencyNudge = (eff - 72) / 15 - (tov - 44) / 24;

  // Pure non-scorers (elite defenders with little offense) are good, but not on
  // the level of shot creators who play serviceable defense.
  const scoringFloor = Math.max(0, 66 - r.scoring) * 0.18;

  const intangibleNudge = (c.elevates - 74) / 11 + (twoWayWinning - 68) / 10 + efficiencyNudge - scoringFloor;

  // DOMINANCE bonus: a convex lift for genuinely dominant primary options.
  const dominanceBonus = Math.max(0, dominance(player) - 82) * 0.45;

  // GENERATIONAL GREATNESS: proven, all-time accomplishment outweighs mere
  // potential, so established legends sit above unproven-but-talented youngsters.
  const legacyBonus = ((player.legacy != null ? player.legacy : 60) - 72) * 0.18;

  // CROSS-ERA REFEREE NORMALIZATION: pre-2000 hand-check/physical eras were far
  // harder to score in (and rim attacks were punished), so production there is
  // worth more; 20s-only stars are both rules-inflated and still unproven.
  const eras = player.eras || ["20s"];
  let eraAdj = 0;
  if (eras.includes("80s") || eras.includes("90s")) eraAdj += 1.5;
  else if (eras.includes("00s")) eraAdj += 0.5;
  if (eras.length === 1 && eras[0] === "20s") eraAdj -= 1.0;

  // SPACING IMPACT: a ball-dominant non-shooter shrinks the floor for everyone.
  const spacingImpact = c.ballDominance >= 80 && r.shooting < 80 ? (80 - r.shooting) * 0.06 + 1 : 0;

  const val =
    peak * 0.82 + peak * longevity * 0.13 + intangibleNudge + dominanceBonus +
    legacyBonus + eraAdj - spacingImpact;
  const result = clamp(Math.round(val), 0, 99);
  _careerCache.set(player.id, result);
  return result;
}

/**
 * Replacement level — the value of a freely-available starter you could roster
 * without using a meaningful pick. Value-above-replacement is measured against
 * this so the gap to a true star is explicit.
 */
const REPLACEMENT_LEVEL = 68;

/** Value above replacement: how much more valuable than a replacement starter. */
function valueAboveReplacement(player) {
  return careerRating(player) - REPLACEMENT_LEVEL;
}

/**
 * Talent tier for a player — a coarse, intuitive bucket that positions players
 * by how much they dominate / drive winning.
 */
function playerTier(player) {
  const c = careerRating(player);
  if (c >= 92) return { n: 1, label: "Superstar", short: "S" };
  if (c >= 87) return { n: 2, label: "All-NBA", short: "1" };
  if (c >= 82) return { n: 3, label: "All-Star", short: "2" };
  if (c >= 77) return { n: 4, label: "Quality starter", short: "3" };
  if (c >= 72) return { n: 5, label: "Starter", short: "4" };
  return { n: 6, label: "Role player", short: "R" };
}

/**
 * Salary value for a player, on a $200 cap for a five-man starting unit. The
 * curve is convex, so franchise talents cost disproportionately more — you can
 * fit one or two stars around role players, but never a whole Tier-1A team.
 */
const SALARY_CAP = 200;
function salaryValue(player) {
  const r = careerRating(player);
  return Math.max(2, Math.round(Math.pow(Math.max(0, r - 55), 1.7) * 0.116));
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

  const creators = starters.filter((p) => c(p).ballDominance >= 80).length;
  const initiators = starters.filter(
    (p) => c(p).ballDominance >= 72 && r(p).playmaking >= 80
  ).length;
  const shooters = starters.filter((p) => r(p).shooting >= 74).length;

  // Only "rigid" creators clog — high-usage players who can't space the floor.
  // Elite high-usage shooters (Curry, Edwards, Tatum) play off the ball and
  // coexist just fine, the way they do in the Olympics / All-Star settings.
  const rigid = starters.filter((p) => c(p).ballDominance >= 80 && r(p).shooting < 72).length;

  let score = 72;
  if (creators >= 1 || initiators >= 1) score += 6;
  else score -= 16; // no one who can create offense

  if (rigid >= 2) score -= (rigid - 1) * 7; // multiple non-spacing ball-stoppers
  score += Math.min(shooters, 4) * 2.5; // floor spacing helps everyone fit

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
const _pairCache = new Map();
function pairSynergy(a, b) {
  const key = a.id + "|" + b.id;
  const hit = _pairCache.get(key);
  if (hit !== undefined) return hit;
  const ra = a.ratings, rb = b.ratings;
  const ca = a.career, cb = b.career;
  const ea = ext(a), eb = ext(b);
  let off = 0, def = 0, offReason = "", defReason = "";

  // Rim-protection level combines shot-blocking and interior defense.
  const aRim = Math.max(ea.blocks || 0, ra.interiorD);
  const bRim = Math.max(eb.blocks || 0, rb.interiorD);

  // --- OFFENSE ---
  // Two ball-dominant creators only clash if at least one can't play off the
  // ball; elite shooters/high-IQ stars share the floor (Olympic-team logic).
  if (ca.ballDominance >= 80 && cb.ballDominance >= 80) {
    const adaptA = ra.shooting * 0.6 + ra.iq * 0.4;
    const adaptB = rb.shooting * 0.6 + rb.iq * 0.4;
    const scale = clamp((82 - Math.min(adaptA, adaptB)) / 22, 0, 1); // adapt>=82 → none
    const pen = (((ca.ballDominance - 80) + (cb.ballDominance - 80)) * 0.12 + 3) * scale;
    if (pen > 0.5) { off -= pen; offReason = "both need the ball and can't play off it"; }
  }
  if (ea.interiorLoad >= 72 && eb.interiorLoad >= 72) {
    off -= ((ea.interiorLoad - 72) + (eb.interiorLoad - 72)) * 0.12 + 2;
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

  const result = { off, def, offReason, defReason };
  _pairCache.set(key, result);
  return result;
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
    (p) => r(p).shooting < 58 && (p.eligible.includes("C") || p.eligible.includes("PF"))
  ).length;
  if (nonShootingBigs >= 1) spacing -= 6; // even one non-spacing big tightens the paint
  if (nonShootingBigs >= 2) spacing -= 10; // two is a genuine clog
  // Ball-dominant non-shooters (e.g. a high-usage, mediocre-shooting forward)
  // shrink the floor and stall everyone else's offense.
  const clogs = starters.filter((p) => c(p).ballDominance >= 78 && r(p).shooting < 74).length;
  if (clogs >= 1) spacing -= clogs * 7;

  const hasEngine = starters.some((p) => r(p).playmaking >= 82);
  let playmaking = avgPlaymaking + (hasEngine ? 10 : -12);

  const avgSteals = avg((p) => ext(p).steals != null ? ext(p).steals : r(p).perimeterD);
  const avgBlocks = avg((p) => ext(p).blocks != null ? ext(p).blocks : r(p).interiorD);
  const hasRim = starters.some((p) => r(p).interiorD >= 82 || ext(p).blocks >= 82);
  const hasStopper = starters.some((p) => r(p).perimeterD >= 80 || ext(p).steals >= 72);
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
  // Cohesion is weighted heavily — a team is more than the sum of its parts.
  const syn = teamSynergy(starters);
  const synAdj = clamp(syn.off, -18, 16) * 0.5 + clamp(syn.def, -10, 18) * 0.5;

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
  return clamp(14 + (strength - 40) * 1.3, 15, 72);
}

/**
 * How well a player suits the slot they're being asked to play. Full value at
 * their natural position, a small haircut at a secondary-eligible spot.
 */
function positionMultiplier(player, slot) {
  if (player.pos === slot) return 1.0;
  if (player.eligible.includes(slot)) return 0.975;
  return 0.94;
}

/**
 * Lineup construction (position-aware): rewards putting the right archetype in
 * the right slot — a lead initiator at the point, a rim-protecting anchor at
 * center, a two-way wing at the 3, shooting at the 2, a stretch/glass 4. This is
 * what makes each roster's composite genuinely depend on WHO is at WHICH spot.
 */
function lineupConstruction(roster) {
  const s = roster.starters;
  let score = 0;
  if (s.PG) score += s.PG.ratings.playmaking >= 80 ? 3 : s.PG.ratings.playmaking >= 72 ? 0 : -3;
  if (s.SG) score += s.SG.ratings.shooting >= 74 ? 2 : s.SG.ratings.shooting >= 66 ? 0 : -2;
  if (s.SF) score += s.SF.ratings.perimeterD >= 76 ? 2 : 0;
  if (s.PF) score += (s.PF.ratings.shooting >= 72 ? 1.5 : 0) + (s.PF.ratings.rebounding >= 70 ? 1 : 0);
  if (s.C) {
    const c = s.C;
    score += c.ratings.interiorD >= 78 || (c.ext && c.ext.blocks >= 80) ? 3 : -3;
    score += c.ratings.rebounding >= 78 ? 1 : 0;
  }
  return score; // ~ -8 .. +12
}

/**
 * Pre-compute everything about a roster that does NOT change season-to-season,
 * so the 15-season loop only does the cheap, t-dependent arithmetic. Big win for
 * evaluateRoster, which is called for every team on the results screen.
 */
function rosterContext(roster) {
  const starters = [];
  const posMult = [];
  for (const pos of POSITIONS) {
    const p = roster.starters[pos];
    if (!p) continue;
    starters.push(p);
    posMult.push(positionMultiplier(p, pos));
  }
  const filled = starters.length;
  const completeness = filled / POSITIONS.length;
  const bench = roster.bench ? roster.bench.filter(Boolean) : [];

  if (filled === 0) {
    return { starters, posMult, bench, filled, completeness, chemistry: 0, construction: 0,
      elevateBoost: 0, avgWinning: 0, avgClutch: 0, alphaBoost: 0 };
  }

  // Lineup construction (who's at which slot) folds into chemistry, so each
  // roster's fit — and thus its composite — is unique to its position assignment.
  const construction = lineupConstruction(roster);
  const chemistry = clamp(chemistryForLineup(starters) + construction, 0, 100) * (0.6 + 0.4 * completeness);
  const avgElevates = starters.reduce((s, p) => s + p.career.elevates, 0) / filled;
  const avgWinning = starters.reduce((s, p) => s + p.career.winning, 0) / filled;
  const avgClutch = starters.reduce((s, p) => s + (ext(p).clutch != null ? ext(p).clutch : 70), 0) / filled;
  // A dominant #1 option lifts a team's playoff ceiling (alphas win playoff games).
  const maxDom = Math.max(...starters.map((p) => dominance(p)));
  const alphaBoost = Math.max(0, maxDom - 86) * 0.25;

  return {
    starters, posMult, bench, filled, completeness, chemistry, construction,
    elevateBoost: (avgElevates - 70) * 0.06, avgWinning, avgClutch, alphaBoost,
  };
}

/** Project a single career season (t) from a precomputed roster context. */
function projectSeason(ctx, t) {
  if (ctx.filled === 0) return { wins: 15, playoffIndex: 0, titleProb: 0, avgStarterValue: 0, chemistry: 0 };

  // Per-starter season value (position-adjusted). Bench can cover a faded
  // starter if it ever has anyone (benchSize is 0 in the live game).
  const benchVals = ctx.bench.length
    ? ctx.bench.map((p) => effectiveSeasonValue(p, t)).sort((a, b) => b - a)
    : null;
  let benchPtr = 0;

  const vals = new Array(ctx.filled);
  let sum = 0;
  for (let i = 0; i < ctx.filled; i++) {
    let v = effectiveSeasonValue(ctx.starters[i], t) * ctx.posMult[i];
    if (benchVals && benchPtr < benchVals.length && benchVals[benchPtr] > v) v = benchVals[benchPtr++];
    vals[i] = v;
    sum += v;
  }

  const avgStarterValue = sum / ctx.filled;
  const strength =
    (avgStarterValue * 0.76 + ctx.chemistry * 0.24 + ctx.elevateBoost) *
    (0.6 + 0.4 * ctx.completeness);
  const wins = strengthToWins(strength);

  const sortedVals = vals.slice().sort((a, b) => b - a);
  const best = sortedVals[0] || 0;
  const top3 = sortedVals.slice(0, 3);
  const top3Avg = top3.reduce((s, v) => s + v, 0) / top3.length;

  // Playoffs reward star power, defense, fit, proven winners, clutch, and having
  // a genuine alpha — so a clutch, star-led, playoff-built team can win titles
  // beyond what its regular-season record suggests.
  const playoffStrength =
    best * 0.38 + top3Avg * 0.25 + ctx.chemistry * 0.16 + avgStarterValue * 0.08 +
    ctx.avgWinning * 0.06 + ctx.avgClutch * 0.07 + ctx.alphaBoost;
  const playoffIndex = clamp((playoffStrength - 45) * 1.6, 0, 100) * ctx.completeness;
  const titleProb = clamp((playoffStrength - 70) / 26, 0, 1) ** 1.7 * 0.42 * ctx.completeness;

  return { wins, playoffIndex, titleProb, avgStarterValue, chemistry: ctx.chemistry };
}

/** Full 15-season evaluation of a roster. */
function evaluateRoster(roster) {
  const ctx = rosterContext(roster); // hoist all season-invariant work out of the loop
  const seasons = [];
  let winsSum = 0;
  let playoffSum = 0;
  let titlesExpected = 0;
  let peakWins = 0;

  for (let t = 0; t < PROJECTION_YEARS; t++) {
    const s = projectSeason(ctx, t);
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

  // COHESION amplifier: a genuinely cohesive team is worth more than the sum of
  // its parts, and a talented-but-disjointed one is worth less. This swings the
  // final composite by roughly ±13%.
  const cohesion = ctx.chemistry; // 0..100, completeness-scaled
  const cohesionMult = 0.87 + (cohesion / 100) * 0.26;
  const composite =
    (avgWins * 0.55 + avgPlayoffIndex * 0.5 + titlesExpected * 4.5 + peakWins * 0.25) * cohesionMult;

  return {
    avgWins,
    avgRecord: `${avgWins.toFixed(1)}-${(82 - avgWins).toFixed(1)}`,
    peakWins: pk,
    bestRecord: `${pk}-${82 - pk}`, // best single-season record at peak
    avgPlayoffIndex,
    cohesion: Math.round(cohesion),
    titlesExpected, // expected value (fractional)
    championships, // rounded total titles over 15 years
    composite,
    seasons,
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
    else if (curCreators === 1) usageAdj -= 1;
    else usageAdj -= 5; // usage logjam (softened)
  } else if (curCreators >= 1 && c(player).ballDominance <= 62 && player.ratings.shooting >= 72) {
    usageAdj += 4; // off-ball spacer next to your creators
  }

  // Pairwise synergy with the players already on the roster: does this pick make
  // the current group better or worse? Kept modest so talent leads the board.
  let synFit = 0;
  for (const mate of starters) {
    const s = pairSynergy(player, mate);
    synFit += s.off + s.def;
  }
  synFit = clamp(synFit, -10, 8) * 0.35;

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

  const ex = (p) => p.ext || {};
  const scorers = s.filter((p) => r(p).scoring >= 88);
  const shooters = s.filter((p) => r(p).shooting >= 74);
  const engines = s.filter((p) => r(p).playmaking >= 82);
  const rim = s.filter((p) => r(p).interiorD >= 82 || ex(p).blocks >= 82);
  const stoppers = s.filter((p) => r(p).perimeterD >= 80 || ex(p).steals >= 72);
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
  const e = player.ext || {};
  if (r.scoring >= 88) out.push("creation");
  if (r.interiorD >= 82 || e.blocks >= 82) out.push("rim");
  if (r.shooting >= 74) out.push("spacing");
  if (r.playmaking >= 82) out.push("playmaking");
  if (r.perimeterD >= 80 || e.steals >= 72) out.push("perimeterD");
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
  dominance,
  valueAboveReplacement,
  playerTier,
  salaryValue,
  SALARY_CAP,
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
