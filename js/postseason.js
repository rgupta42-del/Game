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

  /**
   * Shared-league simulation v2: every drafted team lives in the SAME 15-year
   * window, and each year's title is decided by PLAYED-OUT playoff series —
   * not a probability draw.
   *
   *  • Regular season: each pair trades ~4 head-to-head games per year
   *    (zero-sum, elo-style) on top of their base projection.
   *  • Playoffs: teams are seeded by that year's record and play a best-of-7
   *    bracket using per-year strength (aging curves travel into the bracket,
   *    so a fading core loses its late-era series).
   *  • The Field: the bracket champion must then beat the best of the rest of
   *    the league in one more series — weak rooms don't hand out 15 rings.
   *  • Monte Carlo: the same era is re-run `mcRuns` times on fresh seeds to
   *    measure who BUILT the best team (expected rings, % of eras with the
   *    most rings), separating craft from timeline luck.
   *
   * `entries` = [{ eval, profile }]. Mutates each eval in place with the
   * official timeline (adjusted wins, title flags, championships, titleYears,
   * composite, per-rival playoff series record in _h2h, entry index in _idx)
   * and returns the Monte-Carlo summary { expRings, mostPct, fieldPct, runs }.
   */
  function leagueSim(entries, seedStr, mcRuns) {
    if (!entries || entries.length < 2) return null;
    const N = entries.length;
    const years = entries[0].eval.seasons.length;
    const runs = mcRuns == null ? 400 : mcRuns;

    // Deterministic head-to-head schedule (same in every alternate era).
    const baseWins = entries.map((en) => en.eval.seasons.map((s) => s.wins));
    const adjWins = entries.map((en, i) =>
      en.eval.seasons.map((s, y) => {
        let d = 0;
        for (let j = 0; j < N; j++) {
          if (j === i) continue;
          const p = 1 / (1 + Math.pow(10, (baseWins[j][y] - baseWins[i][y]) / 13));
          d += (p - 0.5) * 4;
        }
        return Math.max(10, Math.min(73, baseWins[i][y] + d));
      })
    );
    // Per-year playoff strength: the era-average profile strength shifted by
    // how good THAT season is (mirrors the profile formula's weights).
    const yearStrength = entries.map((en, i) =>
      en.eval.seasons.map(
        (s, y) =>
          en.profile.strength +
          (s.playoffIndex - en.eval.avgPlayoffIndex) * 0.55 +
          (adjWins[i][y] - en.eval.avgWins) * 0.45
      )
    );

    const HOME = [1, 1, 0, 0, 1, 0, 1];
    // Fast best-of-7 (no game logs): a is the higher seed. Returns true if a wins.
    function seriesWin(a, b, rnd) {
      let wa = 0, wb = 0;
      for (let g = 0; wa < 4 && wb < 4; g++) {
        const diff = a.s - b.s + (HOME[g] === 1 ? 2.6 : -2.6) + (a.c - b.c) * 0.06;
        if (rnd() < 1 / (1 + Math.exp(-diff / 7.5))) wa++;
        else wb++;
      }
      return wa === 4;
    }
    const ORDERS = { 1: [1], 2: [1, 2], 4: [1, 4, 2, 3], 8: [1, 8, 4, 5, 2, 7, 3, 6] };

    /** One full 15-year era. onSeries(winnerIdx, loserIdx) collects h2h. */
    function simEra(rnd, onSeries) {
      const rings = new Array(N).fill(0);
      const titleYears = entries.map(() => []);
      let fieldYears = 0;
      for (let y = 0; y < years; y++) {
        const seeds = entries
          .map((en, i) => ({ i, s: yearStrength[i][y], c: en.profile.clutch, w: adjWins[i][y] }))
          .sort((a, b) => b.w - a.w);
        let size = 1;
        while (size < seeds.length) size *= 2;
        let cur = ORDERS[size].map((k) => seeds[k - 1] || null);
        while (cur.length > 1) {
          const next = [];
          for (let g = 0; g < cur.length; g += 2) {
            const A = cur[g], B = cur[g + 1];
            if (!A || !B) { next.push(A || B); continue; }
            const aWins = seriesWin(A, B, rnd);
            if (onSeries) onSeries(aWins ? A.i : B.i, aWins ? B.i : A.i);
            next.push(aWins ? A : B);
          }
          cur = next;
        }
        const champ = cur[0];
        // Beat the room, then beat the league: the Field is the best of the
        // other franchises — a real contender, tougher some years than others.
        // Calibrated to the profile-strength scale (superteams ≈68-72, strong
        // rosters ≈55, weak ≈36): dynasties clear it most years, good-not-great
        // champs are coin-flippy, weak rooms almost never do.
        const field = { s: 57 + rnd() * 9, c: 82 };
        if (seriesWin(champ, field, rnd)) {
          rings[champ.i]++;
          titleYears[champ.i].push(y + 1);
        } else {
          fieldYears++;
        }
      }
      return { rings, titleYears, fieldYears };
    }

    // ---- The official timeline (applied to the evals everyone sees) --------
    const h2h = entries.map(() => entries.map(() => ({ w: 0, l: 0 })));
    const official = simEra(mulberry32(hashStr("league·" + seedStr)), (wi, li) => {
      h2h[wi][li].w++;
      h2h[li][wi].l++;
    });
    entries.forEach((en, i) => {
      const e = en.eval;
      const mine = new Set(official.titleYears[i]);
      let winsSum = 0, peak = 0;
      e.seasons.forEach((s, y) => {
        s.wins = adjWins[i][y];
        s.title = mine.has(y + 1);
        winsSum += s.wins;
        peak = Math.max(peak, s.wins);
      });
      e.avgWins = winsSum / years;
      e.avgRecord = `${e.avgWins.toFixed(1)}-${(82 - e.avgWins).toFixed(1)}`;
      e.peakWins = Math.round(peak);
      e.bestRecord = `${e.peakWins}-${82 - e.peakWins}`;
      e.championships = official.rings[i];
      e.titleYears = official.titleYears[i];
      e._h2h = h2h[i];
      e._idx = i;
      e.composite =
        (e.avgWins * 0.55 + e.avgPlayoffIndex * 0.5 +
          (e.championships * 3.2 + e.titlesExpected * 1.3) + peak * 0.25) *
        (e._mults || 1);
    });

    // ---- Monte Carlo: who built the team most likely to win ANY era? -------
    const expRings = new Array(N).fill(0);
    const mostShare = new Array(N).fill(0);
    let fieldY = 0;
    for (let k = 0; k < runs; k++) {
      const r = simEra(mulberry32(hashStr("mc·" + seedStr + "·" + k)), null);
      r.rings.forEach((t, i) => (expRings[i] += t));
      fieldY += r.fieldYears;
      const mx = Math.max.apply(null, r.rings);
      const tops = [];
      r.rings.forEach((t, i) => { if (t === mx) tops.push(i); });
      tops.forEach((i) => (mostShare[i] += 1 / tops.length));
    }
    return {
      expRings: expRings.map((x) => x / runs),
      mostPct: mostShare.map((x) => Math.round((100 * x) / runs)),
      fieldPct: Math.round((100 * fieldY) / (runs * years)),
      runs,
    };
  }

  const POSTSEASON = { mulberry32, hashStr, teamProfile, simSeries, simBracket, seriesWinPct, LEGEND_SQUADS, legendRoster, leagueSim };
  if (typeof module !== "undefined" && module.exports) module.exports = POSTSEASON;
  if (typeof window !== "undefined") window.POSTSEASON = POSTSEASON;
})();
