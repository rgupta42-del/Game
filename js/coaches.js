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


  // Verified Wikipedia/Wikimedia portraits (checked at build time; the UI
  // falls back to an initials sprite if any image fails to load).
  const COACH_PHOTOS = {
    adelman: "https://upload.wikimedia.org/wikipedia/commons/0/05/Rick_Adelman.png",
    bud: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/CMuwGzp.jpg/330px-CMuwGzp.jpg",
    carlisle: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/Rick_Carlisle_OPHS_Drive_and_Dish_Presser_2023-11-15_%28cropped2%29.jpg/330px-Rick_Carlisle_OPHS_Drive_and_Dish_Presser_2023-11-15_%28cropped2%29.jpg",
    daly: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/01/Chuck_Daly_%28cropped%29.jpg/330px-Chuck_Daly_%28cropped%29.jpg",
    dantoni: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Mike_D%27Antoni_2010.jpg/330px-Mike_D%27Antoni_2010.jpg",
    doc: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Rivers_76ers.jpg/330px-Rivers_76ers.jpg",
    jvg: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Jeff_Van_Gundy_%28cropped%29.jpg/330px-Jeff_Van_Gundy_%28cropped%29.jpg",
    karl: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/George_Karl.jpg/330px-George_Karl.jpg",
    kcjones: "https://upload.wikimedia.org/wikipedia/commons/4/46/K.C._Jones_-_Boston_celtics_1960_%28cropped%29.JPG",
    kerr: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/58/Joe_Biden_Steph_Curry_Steve_Kerr_P20230117AS-1347_%28cropped%29_%28cropped%29.jpg/330px-Joe_Biden_Steph_Curry_Steve_Kerr_P20230117AS-1347_%28cropped%29_%28cropped%29.jpg",
    lbrown: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/ba/Larry_Brown_2014.png/330px-Larry_Brown_2014.png",
    lue: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/Ty_Lue_Sideline_2022_%28cropped%29.jpg/330px-Ty_Lue_Sideline_2022_%28cropped%29.jpg",
    mazzulla: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Celtics_at_Wizards_2024-12-046_%28cropped%29_%28cropped%29.jpg/330px-Celtics_at_Wizards_2024-12-046_%28cropped%29_%28cropped%29.jpg",
    mbrown: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Mike_Brown_NBA_cropped.jpg/330px-Mike_Brown_NBA_cropped.jpg",
    mmalone: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Michael_Malone_2026.png/330px-Michael_Malone_2026.png",
    monty: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Monty_Williams_%28cropped%29.jpg/330px-Monty_Williams_%28cropped%29.jpg",
    nellie: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/72/Don_Nelson.jpg/330px-Don_Nelson.jpg",
    nurse: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/76/1_nick_nurse_2026.jpg/330px-1_nick_nurse_2026.jpg",
    phil: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fb/Phil_Jackson_Lipofsky_%28high_quality%29_%28cropped%29.JPG/330px-Phil_Jackson_Lipofsky_%28high_quality%29_%28cropped%29.JPG",
    pop: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/eb/Gregg_Popovich_speaks_at_the_White_House_2015-01-12_%28cropped%29.jpg/330px-Gregg_Popovich_speaks_at_the_White_House_2015-01-12_%28cropped%29.jpg",
    riley: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/79/Pat_Riley_speaks_at_Eglin_Air_Force_Base_%28cropped%29.jpg/330px-Pat_Riley_speaks_at_Eglin_Air_Force_Base_%28cropped%29.jpg",
    saunders: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/Flip_Saunders.jpg/330px-Flip_Saunders.jpg",
    sloan: "https://upload.wikimedia.org/wikipedia/commons/a/a1/Jerry_Sloan_at_Energy_Solutions_Arena_%28cropped%29.jpg",
    snyder: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/32/Head_Coach_Quin_Snyder.jpg/330px-Head_Coach_Quin_Snyder.jpg",
    spo: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Erik_Spoelstra_2022_%28cropped%29.jpg/330px-Erik_Spoelstra_2022_%28cropped%29.jpg",
    stevens: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Brad_Stevens_2017.jpg/330px-Brad_Stevens_2017.jpg",
    svg: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Stan_Van_Gundy_Navy_Marine_Corps_Classic_2012_sports_commentators.jpg/330px-Stan_Van_Gundy_Navy_Marine_Corps_Classic_2012_sports_commentators.jpg",
    thibs: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Tom_Thibodeau_-_52977484738_%28cropped%29.jpg/330px-Tom_Thibodeau_-_52977484738_%28cropped%29.jpg",
    vogel: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fe/Frank_Vogel_NBA_TV_%28cropped%29.jpeg/330px-Frank_Vogel_NBA_TV_%28cropped%29.jpeg",
    wilkens: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Lenny_Wilkens_1968_%28cropped%29.jpeg/330px-Lenny_Wilkens_1968_%28cropped%29.jpeg",
  };

  const COACH_POOL = RAW.map(([id, name, overall, traits, style]) => {
    const initials = name
      .replace(/[^A-Za-z .'-]/g, "")
      .split(/[ .'-]+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .slice(0, 3)
      .toUpperCase();
    return { id: "coach_" + id, name, overall, traits, style, isCoach: true, eligible: ["COACH"], initials,
      photo: COACH_PHOTOS[id] || null };
  });

  if (typeof module !== "undefined" && module.exports) module.exports = { COACH_POOL };
  if (typeof window !== "undefined") window.COACH_POOL = COACH_POOL;
})();
