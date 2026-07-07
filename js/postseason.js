/**
 * Postseason theater for the NBA Re-Draft game:
 *   • BRACKET — after the draft, the teams are seeded by their regular-season
 *     projection and play an actual simulated playoff bracket (best-of-7,
 *     2-2-1-1-1 home court, clutch matters), with per-game star lines and a
 *     Finals MVP. Seeded from the draft itself so a shared results link shows
 *     the SAME bracket everywhere; a "re-simulate" reroll is offered for fun.
 *   • LEGEND SQUADS — all-decade super-teams assembled from the player pool.
 *     Challenge them with any drafted roster: a Monte-Carlo win probability
 *     plus one showcase series with a game log.
 */
(function () {
  "use strict";

  // Deterministic PRNG (mulberry32) + string hash, so brackets replay identically.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** Distill a roster + its evaluateRoster() output into playoff-sim numbers. */
  function teamProfile(name, roster, ev) {
    const starters = SCORING.starterPlayers(roster);
    const n = Math.max(1, starters.length);
    const clutch = starters.reduce((s, p) => s + ((p.ext && p.ext.clutch) || 70), 0) / n;
    return {
      name, roster, ev, starters, clutch,
      strength: ev.avgPlayoffIndex * 0.55 + ev.avgWins * 0.45 + (ev.cohesion - 80) * 0.1,
    };
  }

  function gameWinProb(a, b, homeA) {
    const diff = a.strength - b.strength + (homeA ? 2.6 : -2.6) + (a.clutch - b.clutch) * 0.06;
    return 1 / (1 + Math.exp(-diff / 7.5));
  }

  function pickStar(team, rnd) {
    const s = team.starters;
    const w = s.map((p) => Math.pow(Math.max(30, SCORING.dominance(p)), 2));
    let r = rnd() * w.reduce((x, y) => x + y, 0);
    for (let i = 0; i < s.length; i++) {
      r -= w[i];
      if (r <= 0) return s[i];
    }
    return s[0];
  }

  /** Best-of-7, 2-2-1-1-1 (a = higher seed). Returns winner + game log. */
  function simSeries(a, b, rnd) {
    const home = [1, 1, 0, 0, 1, 0, 1];
    let wa = 0, wb = 0;
    const games = [];
    for (let g = 0; wa < 4 && wb < 4; g++) {
      const p = gameWinProb(a, b, home[g] === 1);
      const aWins = rnd() < p;
      if (aWins) wa++; else wb++;
      const w = aWins ? a : b;
      const star = pickStar(w, rnd);
      const pts = Math.round(22 + rnd() * 19 + ((star.ext && star.ext.clutch) || 70) / 9);
      games.push({
        g: g + 1,
        winner: w.name,
        star: star.name,
        pts,
        close: rnd() < 0.35,
      });
    }
    const winner = wa === 4 ? a : b;
    return { winner, loser: wa === 4 ? b : a, score: `4-${Math.min(wa, wb)}`, games };
  }

  /**
   * Full bracket among the drafted teams. `profiles` must be sorted by seed
   * (best first). Byes pad to a power of two. Returns { rounds, champion, mvp }.
   */
  function simBracket(profiles, seedStr) {
    const rnd = mulberry32(hashStr(seedStr));
    let size = 1;
    while (size < profiles.length) size *= 2;
    const ORDERS = { 1: [1], 2: [1, 2], 4: [1, 4, 2, 3], 8: [1, 8, 4, 5, 2, 7, 3, 6] };
    let cur = ORDERS[size].map((seed) => profiles[seed - 1] || null);

    const rounds = [];
    while (cur.length > 1) {
      const next = [];
      const series = [];
      for (let i = 0; i < cur.length; i += 2) {
        const A = cur[i], B = cur[i + 1];
        if (!A || !B) {
          const adv = A || B;
          next.push(adv);
          series.push({ bye: true, winner: adv.name, teamA: A ? A.name : "bye", teamB: B ? B.name : "bye" });
          continue;
        }
        const s = simSeries(A, B, rnd);
        next.push(s.winner);
        series.push({ teamA: A.name, teamB: B.name, winner: s.winner.name, score: s.score, games: s.games });
      }
      rounds.push(series);
      cur = next;
    }

    const champion = cur[0];
    // Finals MVP: biggest star-line producer for the champion in the final series.
    const finals = rounds.length ? rounds[rounds.length - 1][0] : null;
    let mvp = null;
    if (finals && !finals.bye) {
      const tally = {};
      finals.games.forEach((g) => {
        if (g.winner === champion.name) tally[g.star] = (tally[g.star] || 0) + g.pts;
      });
      const top = Object.entries(tally).sort((x, y) => y[1] - x[1])[0];
      if (top) mvp = top[0];
    }
    if (!mvp) mvp = pickStar(champion, rnd).name;
    return { rounds, champion, mvp };
  }

  /** Monte-Carlo series win probability (challenger = a). */
  function seriesWinPct(a, b, trials) {
    const rnd = mulberry32(hashStr(a.name + "×" + b.name + "×gauntlet"));
    let wins = 0;
    const T = trials || 400;
    for (let i = 0; i < T; i++) if (simSeries(a, b, rnd).winner === a) wins++;
    return wins / T;
  }

  // ---- Legend squads (assembled from the pool; ids must exist) -------------
  const LEGEND_SQUADS = [
    { key: "80s", name: "All-'80s Legends", emoji: "📼",
      slots: { PG: "magic", SG: "moncrief", SF: "bird", PF: "mchale", C: "kareem" } },
    { key: "90s", name: "All-'90s Legends", emoji: "🐂",
      slots: { PG: "stockton", SG: "jordan", SF: "pippen", PF: "malone", C: "hakeem" } },
    { key: "00s", name: "All-'00s Legends", emoji: "🕝",
      slots: { PG: "nash", SG: "kobe", SF: "tmac", PF: "duncan", C: "shaq" } },
    { key: "10s", name: "All-'10s Legends", emoji: "🚀",
      slots: { PG: "curry", SG: "harden", SF: "lebron", PF: "durant", C: "adavis" } },
    { key: "20s", name: "All-'20s Legends", emoji: "⚡",
      slots: { PG: "sga", SG: "edwards", SF: "tatum", PF: "giannis", C: "jokic" } },
    { key: "goat", name: "All-Time First Team", emoji: "🐐",
      slots: { PG: "magic", SG: "jordan", SF: "lebron", PF: "duncan", C: "kareem" } },
  ];

  /** Build a { starters } roster for a legend squad from the player pool. */
  function legendRoster(squad) {
    const byId = {};
    (window.PLAYER_POOL || []).forEach((p) => (byId[p.id] = p));
    const starters = { PG: null, SG: null, SF: null, PF: null, C: null };
    Object.keys(squad.slots).forEach((k) => (starters[k] = byId[squad.slots[k]] || null));
    return { starters, bench: [] };
  }

  const POSTSEASON = { mulberry32, hashStr, teamProfile, simSeries, simBracket, seriesWinPct, LEGEND_SQUADS, legendRoster };
  if (typeof module !== "undefined" && module.exports) module.exports = POSTSEASON;
  if (typeof window !== "undefined") window.POSTSEASON = POSTSEASON;
})();
