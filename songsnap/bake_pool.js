/* Dev helper (run with node, needs curl): bake iTunes preview metadata into
 * songs.js so the game needs no search API calls at runtime. Run after editing
 * the pool. Preserves entry order; entries that fail lookup keep no baked
 * fields and fall back to runtime search. */
const { execFile } = require("child_process");
const fs = require("fs");
const SRC = require("path").join(__dirname, "songs.js");
const SONG_POOL = eval(fs.readFileSync(SRC, "utf8") + "; SONG_POOL");

const norm = (s) =>
  String(s).toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ").trim();

const curl = (url) => new Promise((res, rej) =>
  execFile("curl", ["-sS", "--max-time", "20", url], { encoding: "utf8" },
    (e, out) => (e ? rej(e) : res(out))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lookup(song) {
  const term = encodeURIComponent(song.q || `${song.a} ${song.t}`);
  const url = `https://itunes.apple.com/search?media=music&entity=song&limit=25&term=${term}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const data = JSON.parse(await curl(url));
      const nt = norm(song.t), na = norm(song.a);
      const hit = (data.results || []).find((r) => {
        if (!r.previewUrl) return false;
        const rt = norm(r.trackName || ""), ra = norm(r.artistName || "");
        return (rt === nt || rt.startsWith(nt) || nt.startsWith(rt) || rt.includes(nt)) &&
               (ra.includes(na) || na.includes(ra));
      });
      return hit || null;
    } catch { await sleep(1500 * (attempt + 1)); }
  }
  return null;
}

(async () => {
  let done = 0, missing = 0;
  const queue = SONG_POOL.map((s, i) => ({ s, i }));
  const baked = new Array(SONG_POOL.length);
  async function worker() {
    while (queue.length) {
      const { s, i } = queue.shift();
      const hit = await lookup(s);
      if (hit) {
        baked[i] = {
          ...s,
          y: hit.releaseDate ? new Date(hit.releaseDate).getFullYear() : undefined,
          al: hit.collectionName || undefined,
          p: hit.previewUrl,
          art: (hit.artworkUrl100 || "").replace("100x100", "300x300") || undefined,
        };
      } else { baked[i] = { ...s }; missing++; console.log("MISSING:", s.a, "—", s.t); }
      if (++done % 20 === 0) process.stdout.write(` ${done}`);
      await sleep(250);
    }
  }
  await Promise.all([worker(), worker(), worker()]);

  const J = JSON.stringify;
  let currentCat = null;
  const lines = [];
  for (const e of baked) {
    if (e.c !== currentCat) {
      currentCat = e.c;
      lines.push(`\n  // ─── ${currentCat} ${"─".repeat(Math.max(3, 60 - currentCat.length))}`);
    }
    const parts = [`t: ${J(e.t)}`, `a: ${J(e.a)}`, `c: ${J(e.c)}`];
    if (e.q) parts.push(`q: ${J(e.q)}`);
    if (e.y) parts.push(`y: ${e.y}`);
    if (e.al) parts.push(`al: ${J(e.al)}`);
    if (e.p) parts.push(`p: ${J(e.p)}`);
    if (e.art) parts.push(`art: ${J(e.art)}`);
    lines.push(`  { ${parts.join(", ")} },`);
  }
  const header = `/**
 * SongSnap song pool.
 *
 * Fields: t title · a artist · c category · q optional search override,
 * plus metadata baked at build time from the iTunes Search API so the game
 * makes NO search calls at runtime (that API is unreliable/rate-limited in
 * browsers, especially mobile): y year · al album · p official 30-second
 * preview clip URL · art 300x300 artwork. No audio ships in this repo — p
 * points at Apple's public preview assets, the same URLs a runtime search
 * returns. If a baked URL ever rots, game.js falls back to a live JSONP
 * search for that song. Re-bake with scratchpad/bake_pool.js if editing.
 *
 * Categories: "90s Pop", "00s Pop", "Pop Rock", "Hip Hop", "Recent Pop".
 * Wrong-answer options are drawn from the same category, so each category
 * needs a healthy pool (25+).
 */
const SONG_POOL = [`;
  fs.writeFileSync(SRC, header + lines.join("\n") + "\n];\n");
  console.log(`\nbaked ${done - missing}/${done}, missing ${missing} → ${SRC}`);
})();
