/**
 * Active NBA Player Database (2025-26 season vintage)
 *
 * Each player is rated on a 0-100 scale across several skill dimensions.
 * Ratings are subjective approximations intended for a draft game, not an
 * official scouting service.
 *
 * Fields:
 *   id          unique slug
 *   name        display name
 *   age         age during the 2025-26 season
 *   pos         primary position
 *   eligible    positions the player can credibly fill ("within reason")
 *   ratings     skill profile (0-100):
 *                 scoring     - shot creation / volume scoring
 *                 shooting    - outside shooting & spacing
 *                 playmaking  - passing / creation for others
 *                 rebounding  - boards on both ends
 *                 perimeterD  - defending guards/wings
 *                 interiorD   - rim protection / paint defense
 *                 athleticism - burst, speed, vertical
 *                 iq          - feel, decision making, intangibles
 *   injuryRisk  0 (iron man) .. 100 (extremely fragile) based on history/health
 *   potential   0..100 remaining career upside (drives the career-arc model)
 *   archetype   short label
 *
 * The "overall" rating is derived from the skill profile in scoring.js, so it
 * is intentionally NOT stored here.
 */

const PLAYER_POOL = [
  // ---------------------------------------------------------------- POINT GUARDS
  { id: "sga", name: "Shai Gilgeous-Alexander", age: 27, pos: "PG", eligible: ["PG", "SG"],
    ratings: { scoring: 97, shooting: 84, playmaking: 88, rebounding: 60, perimeterD: 86, interiorD: 55, athleticism: 88, iq: 95 },
    injuryRisk: 22, potential: 88, archetype: "Two-way lead guard" },
  { id: "luka", name: "Luka Dončić", age: 27, pos: "PG", eligible: ["PG", "SG"],
    ratings: { scoring: 96, shooting: 85, playmaking: 96, rebounding: 78, perimeterD: 62, interiorD: 50, athleticism: 70, iq: 96 },
    injuryRisk: 48, potential: 86, archetype: "Offensive engine" },
  { id: "curry", name: "Stephen Curry", age: 37, pos: "PG", eligible: ["PG", "SG"],
    ratings: { scoring: 93, shooting: 99, playmaking: 87, rebounding: 55, perimeterD: 68, interiorD: 40, athleticism: 70, iq: 96 },
    injuryRisk: 40, potential: 30, archetype: "Gravity shooter" },
  { id: "halliburton", name: "Tyrese Haliburton", age: 25, pos: "PG", eligible: ["PG", "SG"],
    ratings: { scoring: 82, shooting: 85, playmaking: 95, rebounding: 55, perimeterD: 70, interiorD: 42, athleticism: 78, iq: 92 },
    injuryRisk: 45, potential: 88, archetype: "Pace-and-space maestro" },
  { id: "brunson", name: "Jalen Brunson", age: 29, pos: "PG", eligible: ["PG", "SG"],
    ratings: { scoring: 90, shooting: 82, playmaking: 85, rebounding: 52, perimeterD: 66, interiorD: 45, athleticism: 68, iq: 92 },
    injuryRisk: 30, potential: 72, archetype: "Crafty bucket-getter" },
  { id: "cade", name: "Cade Cunningham", age: 24, pos: "PG", eligible: ["PG", "SG"],
    ratings: { scoring: 87, shooting: 78, playmaking: 90, rebounding: 68, perimeterD: 72, interiorD: 48, athleticism: 78, iq: 88 },
    injuryRisk: 38, potential: 90, archetype: "Jumbo creator" },
  { id: "lamelo", name: "LaMelo Ball", age: 24, pos: "PG", eligible: ["PG", "SG"],
    ratings: { scoring: 86, shooting: 80, playmaking: 92, rebounding: 62, perimeterD: 58, interiorD: 38, athleticism: 82, iq: 84 },
    injuryRisk: 62, potential: 86, archetype: "High-wire playmaker" },
  { id: "maxey", name: "Tyrese Maxey", age: 25, pos: "PG", eligible: ["PG", "SG"],
    ratings: { scoring: 88, shooting: 84, playmaking: 80, rebounding: 50, perimeterD: 68, interiorD: 40, athleticism: 90, iq: 84 },
    injuryRisk: 28, potential: 86, archetype: "Downhill speedster" },
  { id: "fox", name: "De'Aaron Fox", age: 28, pos: "PG", eligible: ["PG", "SG"],
    ratings: { scoring: 88, shooting: 76, playmaking: 84, rebounding: 52, perimeterD: 74, interiorD: 44, athleticism: 95, iq: 84 },
    injuryRisk: 30, potential: 74, archetype: "Blur in transition" },
  { id: "trae", name: "Trae Young", age: 27, pos: "PG", eligible: ["PG"],
    ratings: { scoring: 86, shooting: 83, playmaking: 95, rebounding: 50, perimeterD: 42, interiorD: 30, athleticism: 66, iq: 88 },
    injuryRisk: 32, potential: 74, archetype: "Pick-and-roll savant" },
  { id: "garland", name: "Darius Garland", age: 26, pos: "PG", eligible: ["PG", "SG"],
    ratings: { scoring: 82, shooting: 82, playmaking: 86, rebounding: 46, perimeterD: 58, interiorD: 34, athleticism: 74, iq: 84 },
    injuryRisk: 40, potential: 78, archetype: "Shifty floor general" },
  { id: "murray", name: "Jamal Murray", age: 28, pos: "PG", eligible: ["PG", "SG"],
    ratings: { scoring: 84, shooting: 82, playmaking: 80, rebounding: 54, perimeterD: 64, interiorD: 40, athleticism: 74, iq: 86 },
    injuryRisk: 52, potential: 66, archetype: "Big-game shotmaker" },
  { id: "dlillard", name: "Damian Lillard", age: 35, pos: "PG", eligible: ["PG", "SG"],
    ratings: { scoring: 89, shooting: 90, playmaking: 84, rebounding: 50, perimeterD: 52, interiorD: 34, athleticism: 70, iq: 90 },
    injuryRisk: 58, potential: 28, archetype: "Logo-range closer" },
  { id: "ddaniels", name: "Dyson Daniels", age: 23, pos: "PG", eligible: ["PG", "SG"],
    ratings: { scoring: 68, shooting: 66, playmaking: 76, rebounding: 64, perimeterD: 94, interiorD: 52, athleticism: 84, iq: 82 },
    injuryRisk: 26, potential: 86, archetype: "Point-of-attack menace" },

  // ---------------------------------------------------------------- SHOOTING GUARDS
  { id: "edwards", name: "Anthony Edwards", age: 24, pos: "SG", eligible: ["SG", "SF"],
    ratings: { scoring: 93, shooting: 84, playmaking: 76, rebounding: 62, perimeterD: 82, interiorD: 52, athleticism: 97, iq: 82 },
    injuryRisk: 22, potential: 94, archetype: "Explosive two-way wing" },
  { id: "booker", name: "Devin Booker", age: 29, pos: "SG", eligible: ["SG", "PG", "SF"],
    ratings: { scoring: 91, shooting: 88, playmaking: 82, rebounding: 52, perimeterD: 66, interiorD: 42, athleticism: 76, iq: 88 },
    injuryRisk: 30, potential: 72, archetype: "Three-level scorer" },
  { id: "mitchell", name: "Donovan Mitchell", age: 29, pos: "SG", eligible: ["SG", "PG"],
    ratings: { scoring: 90, shooting: 84, playmaking: 76, rebounding: 54, perimeterD: 70, interiorD: 44, athleticism: 88, iq: 84 },
    injuryRisk: 38, potential: 70, archetype: "Microwave scorer" },
  { id: "bane", name: "Desmond Bane", age: 27, pos: "SG", eligible: ["SG", "SF"],
    ratings: { scoring: 82, shooting: 88, playmaking: 74, rebounding: 60, perimeterD: 74, interiorD: 46, athleticism: 74, iq: 86 },
    injuryRisk: 30, potential: 76, archetype: "Bully-ball sniper" },
  { id: "reaves", name: "Austin Reaves", age: 27, pos: "SG", eligible: ["SG", "PG"],
    ratings: { scoring: 80, shooting: 82, playmaking: 80, rebounding: 52, perimeterD: 62, interiorD: 38, athleticism: 66, iq: 86 },
    injuryRisk: 24, potential: 74, archetype: "Connective scorer" },
  { id: "dwhite", name: "Derrick White", age: 31, pos: "SG", eligible: ["SG", "PG"],
    ratings: { scoring: 76, shooting: 82, playmaking: 78, rebounding: 56, perimeterD: 86, interiorD: 60, athleticism: 78, iq: 90 },
    injuryRisk: 22, potential: 56, archetype: "Two-way glue guard" },
  { id: "lavine", name: "Zach LaVine", age: 30, pos: "SG", eligible: ["SG", "SF"],
    ratings: { scoring: 87, shooting: 86, playmaking: 68, rebounding: 50, perimeterD: 56, interiorD: 38, athleticism: 90, iq: 74 },
    injuryRisk: 50, potential: 56, archetype: "High-flying scorer" },
  { id: "herro", name: "Tyler Herro", age: 26, pos: "SG", eligible: ["SG", "PG"],
    ratings: { scoring: 84, shooting: 86, playmaking: 74, rebounding: 54, perimeterD: 52, interiorD: 34, athleticism: 70, iq: 80 },
    injuryRisk: 40, potential: 72, archetype: "Shot-making guard" },
  { id: "mcollum", name: "CJ McCollum", age: 34, pos: "SG", eligible: ["SG", "PG"],
    ratings: { scoring: 82, shooting: 84, playmaking: 72, rebounding: 48, perimeterD: 50, interiorD: 34, athleticism: 66, iq: 84 },
    injuryRisk: 44, potential: 26, archetype: "Veteran shotmaker" },

  // ---------------------------------------------------------------- SMALL FORWARDS
  { id: "tatum", name: "Jayson Tatum", age: 27, pos: "SF", eligible: ["SF", "PF", "SG"],
    ratings: { scoring: 93, shooting: 86, playmaking: 80, rebounding: 74, perimeterD: 82, interiorD: 58, athleticism: 84, iq: 88 },
    injuryRisk: 55, potential: 80, archetype: "Two-way franchise wing" },
  { id: "durant", name: "Kevin Durant", age: 37, pos: "SF", eligible: ["SF", "PF"],
    ratings: { scoring: 95, shooting: 92, playmaking: 76, rebounding: 64, perimeterD: 72, interiorD: 64, athleticism: 76, iq: 90 },
    injuryRisk: 58, potential: 28, archetype: "Unguardable scorer" },
  { id: "lebron", name: "LeBron James", age: 41, pos: "SF", eligible: ["SF", "PF", "PG"],
    ratings: { scoring: 88, shooting: 78, playmaking: 92, rebounding: 74, perimeterD: 70, interiorD: 60, athleticism: 78, iq: 99 },
    injuryRisk: 50, potential: 14, archetype: "Ageless point-forward" },
  { id: "kawhi", name: "Kawhi Leonard", age: 34, pos: "SF", eligible: ["SF", "PF", "SG"],
    ratings: { scoring: 90, shooting: 84, playmaking: 72, rebounding: 66, perimeterD: 92, interiorD: 64, athleticism: 80, iq: 90 },
    injuryRisk: 78, potential: 30, archetype: "Two-way assassin" },
  { id: "butler", name: "Jimmy Butler", age: 36, pos: "SF", eligible: ["SF", "SG", "PF"],
    ratings: { scoring: 82, shooting: 72, playmaking: 80, rebounding: 60, perimeterD: 88, interiorD: 58, athleticism: 74, iq: 92 },
    injuryRisk: 52, potential: 26, archetype: "Playoff riser" },
  { id: "pgeorge", name: "Paul George", age: 35, pos: "SF", eligible: ["SF", "SG", "PF"],
    ratings: { scoring: 84, shooting: 84, playmaking: 76, rebounding: 60, perimeterD: 82, interiorD: 52, athleticism: 76, iq: 86 },
    injuryRisk: 64, potential: 30, archetype: "Two-way wing" },
  { id: "fwagner", name: "Franz Wagner", age: 24, pos: "SF", eligible: ["SF", "PF", "SG"],
    ratings: { scoring: 83, shooting: 76, playmaking: 80, rebounding: 64, perimeterD: 80, interiorD: 54, athleticism: 80, iq: 86 },
    injuryRisk: 30, potential: 90, archetype: "Do-it-all forward" },
  { id: "anunoby", name: "OG Anunoby", age: 28, pos: "SF", eligible: ["SF", "PF", "SG"],
    ratings: { scoring: 74, shooting: 80, playmaking: 56, rebounding: 60, perimeterD: 92, interiorD: 62, athleticism: 84, iq: 80 },
    injuryRisk: 36, potential: 64, archetype: "3-and-D wrecking ball" },
  { id: "mbridges", name: "Mikal Bridges", age: 29, pos: "SF", eligible: ["SF", "SG", "PF"],
    ratings: { scoring: 78, shooting: 80, playmaking: 64, rebounding: 52, perimeterD: 86, interiorD: 52, athleticism: 82, iq: 82 },
    injuryRisk: 14, potential: 60, archetype: "Iron-man wing" },
  { id: "bingram", name: "Brandon Ingram", age: 28, pos: "SF", eligible: ["SF", "PF", "SG"],
    ratings: { scoring: 85, shooting: 80, playmaking: 76, rebounding: 56, perimeterD: 62, interiorD: 44, athleticism: 74, iq: 82 },
    injuryRisk: 48, potential: 64, archetype: "Smooth shotmaker" },
  { id: "derozan", name: "DeMar DeRozan", age: 36, pos: "SF", eligible: ["SF", "SG", "PF"],
    ratings: { scoring: 84, shooting: 70, playmaking: 76, rebounding: 52, perimeterD: 56, interiorD: 40, athleticism: 66, iq: 86 },
    injuryRisk: 30, potential: 24, archetype: "Mid-range maestro" },
  { id: "bmiller", name: "Brandon Miller", age: 23, pos: "SF", eligible: ["SF", "SG", "PF"],
    ratings: { scoring: 80, shooting: 80, playmaking: 66, rebounding: 56, perimeterD: 72, interiorD: 46, athleticism: 80, iq: 78 },
    injuryRisk: 34, potential: 88, archetype: "Scoring wing on the rise" },
  { id: "amen", name: "Amen Thompson", age: 23, pos: "SF", eligible: ["SF", "PG", "SG", "PF"],
    ratings: { scoring: 72, shooting: 56, playmaking: 80, rebounding: 70, perimeterD: 90, interiorD: 58, athleticism: 97, iq: 80 },
    injuryRisk: 26, potential: 94, archetype: "Positionless freak" },

  // ---------------------------------------------------------------- POWER FORWARDS
  { id: "giannis", name: "Giannis Antetokounmpo", age: 31, pos: "PF", eligible: ["PF", "C", "SF"],
    ratings: { scoring: 95, shooting: 60, playmaking: 80, rebounding: 90, perimeterD: 80, interiorD: 86, athleticism: 96, iq: 86 },
    injuryRisk: 40, potential: 64, archetype: "Two-way force of nature" },
  { id: "paolo", name: "Paolo Banchero", age: 23, pos: "PF", eligible: ["PF", "SF", "C"],
    ratings: { scoring: 87, shooting: 74, playmaking: 78, rebounding: 72, perimeterD: 68, interiorD: 58, athleticism: 82, iq: 82 },
    injuryRisk: 36, potential: 92, archetype: "Bully creator" },
  { id: "scottie", name: "Scottie Barnes", age: 24, pos: "PF", eligible: ["PF", "SF", "C"],
    ratings: { scoring: 78, shooting: 66, playmaking: 82, rebounding: 74, perimeterD: 82, interiorD: 64, athleticism: 86, iq: 84 },
    injuryRisk: 28, potential: 90, archetype: "Point-forward hub" },
  { id: "siakam", name: "Pascal Siakam", age: 31, pos: "PF", eligible: ["PF", "SF", "C"],
    ratings: { scoring: 84, shooting: 76, playmaking: 72, rebounding: 70, perimeterD: 74, interiorD: 60, athleticism: 80, iq: 84 },
    injuryRisk: 22, potential: 52, archetype: "Versatile two-way forward" },
  { id: "markkanen", name: "Lauri Markkanen", age: 28, pos: "PF", eligible: ["PF", "C", "SF"],
    ratings: { scoring: 84, shooting: 86, playmaking: 56, rebounding: 74, perimeterD: 60, interiorD: 56, athleticism: 78, iq: 76 },
    injuryRisk: 32, potential: 64, archetype: "Unicorn stretch four" },
  { id: "jjj", name: "Jaren Jackson Jr.", age: 26, pos: "PF", eligible: ["PF", "C"],
    ratings: { scoring: 80, shooting: 78, playmaking: 50, rebounding: 66, perimeterD: 76, interiorD: 92, athleticism: 82, iq: 78 },
    injuryRisk: 44, potential: 78, archetype: "Stretch rim-protector" },
  { id: "jjohnson", name: "Jalen Johnson", age: 24, pos: "PF", eligible: ["PF", "SF", "C"],
    ratings: { scoring: 78, shooting: 66, playmaking: 76, rebounding: 76, perimeterD: 76, interiorD: 62, athleticism: 90, iq: 78 },
    injuryRisk: 42, potential: 86, archetype: "Transition point-forward" },
  { id: "agordon", name: "Aaron Gordon", age: 30, pos: "PF", eligible: ["PF", "SF", "C"],
    ratings: { scoring: 72, shooting: 72, playmaking: 60, rebounding: 72, perimeterD: 80, interiorD: 68, athleticism: 88, iq: 80 },
    injuryRisk: 34, potential: 44, archetype: "Connective athlete" },
  { id: "draymond", name: "Draymond Green", age: 35, pos: "PF", eligible: ["PF", "C"],
    ratings: { scoring: 52, shooting: 56, playmaking: 86, rebounding: 74, perimeterD: 88, interiorD: 82, athleticism: 70, iq: 96 },
    injuryRisk: 44, potential: 22, archetype: "Defensive QB" },

  // ---------------------------------------------------------------- CENTERS
  { id: "jokic", name: "Nikola Jokić", age: 30, pos: "C", eligible: ["C", "PF"],
    ratings: { scoring: 93, shooting: 80, playmaking: 99, rebounding: 92, perimeterD: 56, interiorD: 74, athleticism: 58, iq: 99 },
    injuryRisk: 18, potential: 70, archetype: "Point-center fulcrum" },
  { id: "embiid", name: "Joel Embiid", age: 31, pos: "C", eligible: ["C", "PF"],
    ratings: { scoring: 95, shooting: 78, playmaking: 72, rebounding: 86, perimeterD: 64, interiorD: 92, athleticism: 78, iq: 84 },
    injuryRisk: 82, potential: 50, archetype: "Dominant two-way big" },
  { id: "wemby", name: "Victor Wembanyama", age: 22, pos: "C", eligible: ["C", "PF"],
    ratings: { scoring: 88, shooting: 78, playmaking: 70, rebounding: 86, perimeterD: 78, interiorD: 98, athleticism: 88, iq: 86 },
    injuryRisk: 50, potential: 99, archetype: "Generational unicorn" },
  { id: "bam", name: "Bam Adebayo", age: 28, pos: "C", eligible: ["C", "PF"],
    ratings: { scoring: 74, shooting: 60, playmaking: 76, rebounding: 80, perimeterD: 86, interiorD: 84, athleticism: 86, iq: 86 },
    injuryRisk: 20, potential: 60, archetype: "Switch-everything anchor" },
  { id: "kat", name: "Karl-Anthony Towns", age: 30, pos: "C", eligible: ["C", "PF"],
    ratings: { scoring: 86, shooting: 86, playmaking: 64, rebounding: 86, perimeterD: 54, interiorD: 66, athleticism: 72, iq: 76 },
    injuryRisk: 40, potential: 56, archetype: "Stretch-five scorer" },
  { id: "sabonis", name: "Domantas Sabonis", age: 29, pos: "C", eligible: ["C", "PF"],
    ratings: { scoring: 80, shooting: 64, playmaking: 84, rebounding: 94, perimeterD: 52, interiorD: 64, athleticism: 64, iq: 88 },
    injuryRisk: 24, potential: 56, archetype: "Hub center / glass cleaner" },
  { id: "chet", name: "Chet Holmgren", age: 23, pos: "C", eligible: ["C", "PF"],
    ratings: { scoring: 78, shooting: 78, playmaking: 56, rebounding: 76, perimeterD: 70, interiorD: 94, athleticism: 78, iq: 82 },
    injuryRisk: 48, potential: 92, archetype: "Modern stretch-rim five" },
  { id: "mobley", name: "Evan Mobley", age: 24, pos: "C", eligible: ["C", "PF"],
    ratings: { scoring: 74, shooting: 62, playmaking: 64, rebounding: 80, perimeterD: 80, interiorD: 92, athleticism: 84, iq: 82 },
    injuryRisk: 26, potential: 90, archetype: "DPOY-caliber anchor" },
  { id: "sengun", name: "Alperen Şengün", age: 23, pos: "C", eligible: ["C", "PF"],
    ratings: { scoring: 82, shooting: 56, playmaking: 86, rebounding: 84, perimeterD: 52, interiorD: 62, athleticism: 62, iq: 88 },
    injuryRisk: 28, potential: 88, archetype: "Playmaking center" },
  { id: "gobert", name: "Rudy Gobert", age: 33, pos: "C", eligible: ["C"],
    ratings: { scoring: 58, shooting: 30, playmaking: 44, rebounding: 92, perimeterD: 56, interiorD: 96, athleticism: 76, iq: 78 },
    injuryRisk: 30, potential: 36, archetype: "Rim-protecting deterrent" },
  { id: "turner", name: "Myles Turner", age: 29, pos: "C", eligible: ["C", "PF"],
    ratings: { scoring: 68, shooting: 78, playmaking: 44, rebounding: 70, perimeterD: 58, interiorD: 88, athleticism: 74, iq: 78 },
    injuryRisk: 38, potential: 46, archetype: "Stretch-five shot-blocker" },
  { id: "jallen", name: "Jarrett Allen", age: 27, pos: "C", eligible: ["C"],
    ratings: { scoring: 70, shooting: 40, playmaking: 50, rebounding: 86, perimeterD: 54, interiorD: 84, athleticism: 82, iq: 78 },
    injuryRisk: 24, potential: 56, archetype: "Lob-finishing anchor" },
  { id: "kessler", name: "Walker Kessler", age: 24, pos: "C", eligible: ["C"],
    ratings: { scoring: 60, shooting: 30, playmaking: 38, rebounding: 88, perimeterD: 46, interiorD: 92, athleticism: 80, iq: 72 },
    injuryRisk: 22, potential: 74, archetype: "Rim-running shot-blocker" },

  // --------------------------------------------------- TWO-WAY / FRONTCOURT FLEX
  { id: "adavis", name: "Anthony Davis", age: 32, pos: "PF", eligible: ["PF", "C"],
    ratings: { scoring: 86, shooting: 66, playmaking: 60, rebounding: 88, perimeterD: 74, interiorD: 96, athleticism: 82, iq: 84 },
    injuryRisk: 70, potential: 46, archetype: "Two-way frontcourt star" },
  { id: "jwilliams", name: "Jalen Williams", age: 24, pos: "SF", eligible: ["SF", "SG", "PF"],
    ratings: { scoring: 84, shooting: 78, playmaking: 78, rebounding: 58, perimeterD: 84, interiorD: 54, athleticism: 84, iq: 86 },
    injuryRisk: 24, potential: 90, archetype: "Two-way connector" },
  { id: "jbrown", name: "Jaylen Brown", age: 29, pos: "SG", eligible: ["SG", "SF"],
    ratings: { scoring: 86, shooting: 78, playmaking: 64, rebounding: 60, perimeterD: 82, interiorD: 52, athleticism: 90, iq: 78 },
    injuryRisk: 34, potential: 64, archetype: "Athletic two-way wing" },
  { id: "kporzingis", name: "Kristaps Porziņģis", age: 30, pos: "C", eligible: ["C", "PF"],
    ratings: { scoring: 82, shooting: 82, playmaking: 50, rebounding: 72, perimeterD: 56, interiorD: 86, athleticism: 64, iq: 78 },
    injuryRisk: 72, potential: 40, archetype: "Stretch-five unicorn" },
];

// Make available both as a module export and on the global scope (browser).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { PLAYER_POOL };
}
if (typeof window !== "undefined") {
  window.PLAYER_POOL = PLAYER_POOL;
}
