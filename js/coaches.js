/**
 * Head-coach pool for the NBA Re-Draft game (optional "draft a coach" mode).
 *
 * The top ~30 head coaches since the 1980s. Each coach has:
 *   - overall   : coaching pedigree (drives salary; Phil Jackson tops the scale
 *                 at a Jokić/Jordan-level price, tiering down from there).
 *   - style     : a short label for the UI (derived from the strongest trait).
 *   - traits    : { off, def, pace, dev, culture } 0..100 — used by the analytics
 *                 engine to reward STYLE FIT (a defensive coach lifts a defensive
 *                 roster; a run-and-gun coach lifts a fast, spacing roster; a
 *                 culture coach steadies a shaky locker room) and to model how
 *                 well the coach maximizes each player's talent (dev × the team's
 *                 coachability).
 *
 * Coaches are NOT filtered by the era selector — any coach can be hired in any
 * draft. They cost salary in cap mode (which rises to $250 when coaches are on).
 */
(function () {
  "use strict";

  // [id, name, overall, {off,def,pace,dev,culture}, style]
  const RAW = [
    ["phil",     "Phil Jackson",      95, { off: 88, def: 85, pace: 70, dev: 90, culture: 96 }, "Culture / Triangle"],
    ["pop",      "Gregg Popovich",    94, { off: 88, def: 95, pace: 78, dev: 96, culture: 95 }, "Defense / Versatile"],
    ["riley",    "Pat Riley",         90, { off: 84, def: 90, pace: 80, dev: 80, culture: 90 }, "Defense / Showtime"],
    ["kerr",     "Steve Kerr",        89, { off: 95, def: 82, pace: 88, dev: 80, culture: 92 }, "Motion offense / Pace"],
    ["spo",      "Erik Spoelstra",    89, { off: 84, def: 92, pace: 80, dev: 88, culture: 90 }, "Defense / Versatile"],
    ["daly",     "Chuck Daly",        86, { off: 75, def: 95, pace: 64, dev: 78, culture: 84 }, "Defense (Bad Boys)"],
    ["sloan",    "Jerry Sloan",       86, { off: 90, def: 82, pace: 72, dev: 84, culture: 88 }, "Pick-and-roll / Culture"],
    ["carlisle", "Rick Carlisle",     86, { off: 90, def: 82, pace: 76, dev: 84, culture: 82 }, "Offense / Versatile"],
    ["dantoni",  "Mike D'Antoni",     85, { off: 95, def: 60, pace: 99, dev: 78, culture: 78 }, "Run & gun (pace)"],
    ["adelman",  "Rick Adelman",      85, { off: 92, def: 74, pace: 84, dev: 82, culture: 82 }, "Offense / Pace"],
    ["thibs",    "Tom Thibodeau",     85, { off: 74, def: 97, pace: 62, dev: 78, culture: 80 }, "Defense"],
    ["lbrown",   "Larry Brown",       85, { off: 82, def: 92, pace: 68, dev: 86, culture: 78 }, "Defense (play the right way)"],
    ["nurse",    "Nick Nurse",        84, { off: 84, def: 88, pace: 80, dev: 82, culture: 80 }, "Defense / Versatile"],
    ["bud",      "Mike Budenholzer",  84, { off: 88, def: 80, pace: 82, dev: 78, culture: 80 }, "Offense / Spacing"],
    ["lue",      "Tyronn Lue",        84, { off: 86, def: 82, pace: 80, dev: 78, culture: 84 }, "Versatile"],
    ["stevens",  "Brad Stevens",      84, { off: 86, def: 84, pace: 78, dev: 84, culture: 82 }, "Versatile"],
    ["kcjones",  "K.C. Jones",        84, { off: 84, def: 84, pace: 78, dev: 76, culture: 90 }, "Culture"],
    ["karl",     "George Karl",       83, { off: 88, def: 74, pace: 90, dev: 80, culture: 74 }, "Pace / Offense"],
    ["snyder",   "Quin Snyder",       83, { off: 90, def: 78, pace: 82, dev: 84, culture: 80 }, "Offense / Spacing"],
    ["doc",      "Doc Rivers",        83, { off: 82, def: 82, pace: 76, dev: 76, culture: 88 }, "Culture"],
    ["nellie",   "Don Nelson",        83, { off: 90, def: 58, pace: 96, dev: 80, culture: 72 }, "Run & gun (Nellie ball)"],
    ["mmalone",  "Michael Malone",    83, { off: 86, def: 82, pace: 78, dev: 82, culture: 82 }, "Offense / Versatile"],
    ["wilkens",  "Lenny Wilkens",     82, { off: 84, def: 82, pace: 76, dev: 80, culture: 84 }, "Versatile"],
    ["jvg",      "Jeff Van Gundy",    82, { off: 72, def: 95, pace: 60, dev: 76, culture: 80 }, "Defense (grind it out)"],
    ["mbrown",   "Mike Brown",        82, { off: 80, def: 92, pace: 80, dev: 78, culture: 80 }, "Defense"],
    ["vogel",    "Frank Vogel",       82, { off: 76, def: 93, pace: 70, dev: 76, culture: 80 }, "Defense"],
    ["mazzulla", "Joe Mazzulla",      82, { off: 92, def: 82, pace: 84, dev: 76, culture: 78 }, "Offense / Spacing"],
    ["monty",    "Monty Williams",    81, { off: 84, def: 82, pace: 76, dev: 80, culture: 86 }, "Culture"],
    ["svg",      "Stan Van Gundy",    80, { off: 82, def: 90, pace: 74, dev: 76, culture: 76 }, "Defense"],
    ["saunders", "Flip Saunders",     80, { off: 86, def: 78, pace: 78, dev: 80, culture: 80 }, "Offense"],
  ];

  const COACH_POOL = RAW.map(([id, name, overall, traits, style]) => {
    const initials = name
      .replace(/[^A-Za-z .'-]/g, "")
      .split(/[ .'-]+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .slice(0, 3)
      .toUpperCase();
    return { id: "coach_" + id, name, overall, traits, style, isCoach: true, eligible: ["COACH"], initials };
  });

  if (typeof module !== "undefined" && module.exports) module.exports = { COACH_POOL };
  if (typeof window !== "undefined") window.COACH_POOL = COACH_POOL;
})();
