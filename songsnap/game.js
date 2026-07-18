/**
 * SongSnap — daily 5-round song-guessing game.
 *
 * Flow: pick 5 deterministic daily songs (seeded by local date) → fetch
 * official 30s iTunes preview clips at runtime → each round plays the first
 * 5 seconds of the clip, then a 10-second guess window opens with 5 options.
 * Points: answer in the 1st second = 100, 2nd = 90 … window expires = 0.
 * Wrong answer = 0. While the clock runs you can Replay the clip (free) or
 * take a written Hint (−30 pts, floor 0); at the 5-second mark two wrong
 * options are eliminated. Results are shareable and saved to a per-day,
 * on-device leaderboard.
 */
"use strict";
(() => {
  const CLIP_SECONDS = 5;
  const GUESS_SECONDS = 10;
  const ROUNDS = 5;
  const OPTIONS = 5;
  const MAX_ROUND_POINTS = 100;
  const HINT_COST = 30;
  const ELIMINATE_AT_MS = 5000; // halfway: 2 wrong options vanish
  const ELIMINATE_COUNT = 2;
  const MAX_PER_CATEGORY = 2; // variety guard for the daily five
  const EPOCH = "2026-07-11"; // game #1 — a week before launch so the archive opens with history

  const $ = (id) => document.getElementById(id);
  const pad2 = (n) => String(n).padStart(2, "0");
  const keyOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const todayKey = keyOf(new Date());
  const gameNoFor = (k) =>
    Math.max(1, Math.round((Date.parse(k) - Date.parse(EPOCH)) / 864e5) + 1);

  // Which day is being played: today's daily by default, or a past date in
  // archive mode (shareable, replayable, but never touches the daily
  // leaderboard or the once-per-day lock).
  let activeDate = todayKey;
  let isArchive = false;

  // ── storage (private-mode safe) ─────────────────────────────────────────
  const store = {
    get(k) {
      try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ }
    },
  };
  const K_NAME = "songsnap:name";
  const K_ALIAS = "songsnap:alias";
  const K_PLAYED = `songsnap:played:${todayKey}`;
  const K_BOARD = `songsnap:board:${todayKey}`;
  const K_POSTED = `songsnap:posted:${todayKey}`;

  // ── shared leaderboard backend (Firebase RTDB REST — same database the
  // NBA game's live sync uses; /drafts/* is the path its rules leave open,
  // so SongSnap lives in a namespace under it). The local board remains as
  // an offline fallback. window.SONGSNAP_DB_BASE is a test hook.
  const DB_BASE = window.SONGSNAP_DB_BASE ||
    "https://nba-redraft-b85ce-default-rtdb.firebaseio.com/drafts/songsnap";

  function dbFetch(url, opts = {}, timeoutMs = 8000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(t));
  }

  // Sequential "Player 0001"-style aliases via an atomic counter (ETag
  // compare-and-swap); random 4-digit fallback if the network fights back.
  async function claimAlias() {
    for (let i = 0; i < 4; i++) {
      const res = await dbFetch(`${DB_BASE}/aliasCounter.json`, {
        headers: { "X-Firebase-ETag": "true" },
      });
      if (!res.ok) break;
      const etag = res.headers.get("ETag");
      const n = (await res.json()) || 0;
      const put = await dbFetch(`${DB_BASE}/aliasCounter.json`, {
        method: "PUT", headers: { "if-match": etag }, body: JSON.stringify(n + 1),
      });
      if (put.ok) return n + 1;
      if (put.status !== 412) break; // 412 = lost the race — try again
    }
    throw new Error("alias counter unavailable");
  }

  async function ensureName() {
    const typed = (store.get(K_NAME) || "").trim();
    if (typed) return typed.slice(0, 20);
    let alias = store.get(K_ALIAS);
    if (!alias) {
      try { alias = `Player ${String(await claimAlias()).padStart(4, "0")}`; }
      catch { alias = `Player ${1000 + Math.floor(Math.random() * 9000)}`; }
      store.set(K_ALIAS, alias);
    }
    return alias;
  }

  async function postScore(name, score) {
    const res = await dbFetch(`${DB_BASE}/boards/${todayKey}.json`, {
      method: "POST",
      body: JSON.stringify({ name, score, ts: Date.now() }),
    });
    if (!res.ok) throw new Error(`post failed: ${res.status}`);
    return (await res.json()).name; // Firebase push key
  }

  // Players who finished before the shared board existed (or while offline)
  // get their stored result posted on their next visit.
  async function backfillPost(played) {
    if (store.get(K_POSTED)) return;
    try {
      let name = (played.name || "").trim();
      if (!name || name === "Player") name = await ensureName();
      const score = (played.results || []).reduce((s, x) => s + x.pts, 0);
      store.set(K_POSTED, await postScore(name, score));
    } catch { /* still offline — retried on the next visit */ }
  }

  // ── seeded RNG (xmur3 + mulberry32) so everyone gets the same daily mix ─
  function seededRng(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    let a = (h ^= h >>> 16) >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seededShuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ── iTunes Search API via JSONP (works from file:// and any static host) ─
  let jsonpSeq = 0;
  function jsonp(url, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const cb = `__songsnap_cb_${++jsonpSeq}`;
      const s = document.createElement("script");
      const timer = setTimeout(() => { cleanup(); reject(new Error("timeout")); }, timeoutMs);
      function cleanup() {
        clearTimeout(timer);
        delete window[cb];
        s.remove();
      }
      window[cb] = (data) => { cleanup(); resolve(data); };
      s.onerror = () => { cleanup(); reject(new Error("network")); };
      s.src = `${url}&callback=${cb}`;
      document.head.appendChild(s);
    });
  }

  const norm = (s) =>
    String(s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\(.*?\)|\[.*?\]/g, " ")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  // Preview metadata is baked into songs.js at build time, so the normal
  // path touches no search API (it's unreliable/rate-limited in browsers,
  // especially mobile). The live JSONP search below survives only as a
  // fallback for entries without baked data or with a rotted preview URL.
  function resolveMedia(song) {
    if (song.p) {
      return { previewUrl: song.p, artwork: song.art || "", year: song.y || null, album: song.al || "" };
    }
    return findPreview(song);
  }

  async function findPreview(song) {
    const term = encodeURIComponent(song.q || `${song.a} ${song.t}`);
    const data = await jsonp(
      `https://itunes.apple.com/search?media=music&entity=song&limit=25&term=${term}`
    );
    const nt = norm(song.t);
    const na = norm(song.a);
    const hit = (data.results || []).find((r) => {
      if (!r.previewUrl) return false;
      const rt = norm(r.trackName || "");
      const ra = norm(r.artistName || "");
      const titleOk = rt === nt || rt.startsWith(nt) || nt.startsWith(rt) || rt.includes(nt);
      const artistOk = ra.includes(na) || na.includes(ra);
      return titleOk && artistOk;
    });
    if (!hit) throw new Error(`no preview for ${song.t}`);
    return {
      previewUrl: hit.previewUrl,
      artwork: (hit.artworkUrl100 || "").replace("100x100", "300x300"),
      year: hit.releaseDate ? new Date(hit.releaseDate).getFullYear() : null,
      album: hit.collectionName || "",
    };
  }

  // ── daily puzzle assembly ───────────────────────────────────────────────
  // Walk the seeded shuffle of the pool (≤2 per category) and keep the first
  // five songs whose iTunes preview actually resolves — deterministic even
  // when a lookup fails, since everyone walks the same order.
  async function buildDaily(onProgress) {
    const rng = seededRng(`songsnap:${activeDate}`);
    const order = seededShuffle(SONG_POOL, rng);
    const rounds = [];
    const catCount = {};
    const chosenTitles = new Set();

    for (const song of order) {
      if (rounds.length >= ROUNDS) break;
      if ((catCount[song.c] || 0) >= MAX_PER_CATEGORY) continue;
      onProgress(rounds.length, song.c);
      try {
        const media = await resolveMedia(song);
        catCount[song.c] = (catCount[song.c] || 0) + 1;
        chosenTitles.add(song.t + "|" + song.a);
        rounds.push({ song, media });
      } catch { /* preview unavailable — walk on to the next candidate */ }
    }
    if (rounds.length < ROUNDS) throw new Error("not enough previews");

    // 4 same-category decoys per round, deterministic per date+round.
    rounds.forEach((round, i) => {
      const rr = seededRng(`songsnap:${activeDate}:r${i}`);
      const decoys = seededShuffle(
        SONG_POOL.filter(
          (s) => s.c === round.song.c && !chosenTitles.has(s.t + "|" + s.a)
        ),
        rr
      ).slice(0, OPTIONS - 1);
      round.options = seededShuffle([round.song, ...decoys], rr);
      round.eliminate = seededShuffle(decoys, rr).slice(0, ELIMINATE_COUNT);
    });
    return rounds;
  }

  // ── game state ──────────────────────────────────────────────────────────
  let rounds = [];        // [{song, media, options}]
  let audios = [];        // preloaded Audio per round
  let current = 0;
  let results = [];       // [{t, a, art, pts, outcome: "hit"|"miss"|"timeout"}]
  let clipTimer = null;
  let guessTimer = null;
  let replayTimer = null;
  let guessStart = 0;
  let hintUsed = false;
  let eliminated = false;
  let phase = "idle";     // idle | listening | guessing | reveal

  const totalScore = () => results.reduce((s, r) => s + r.pts, 0);
  const playerName = () =>
    ((store.get(K_NAME) || "").trim() || store.get(K_ALIAS) || "Player").slice(0, 20);

  function show(id) {
    for (const s of document.querySelectorAll(".screen")) s.classList.remove("active");
    $(id).classList.add("active");
  }

  function stopAudio() {
    for (const a of audios) { try { a.pause(); } catch { /* not started */ } }
    clearInterval(clipTimer);
    clearInterval(guessTimer);
    clearInterval(replayTimer);
    clipTimer = guessTimer = replayTimer = null;
  }

  // ── home ────────────────────────────────────────────────────────────────
  function initHome() {
    $("game-no").textContent = `#${gameNoFor(todayKey)} · ${todayKey}`;
    $("name-input").value = store.get(K_NAME) || "";
    const played = store.get(K_PLAYED);
    if (played) {
      $("start-btn").textContent = "See today's results";
      $("home-note").textContent = "You've already played today — new mix at midnight!";
      // Post any pre-update/offline score the moment the page opens — don't
      // wait for the player to tap through to the results screen.
      backfillPost(played);
    }
    show("screen-home");
  }

  $("start-btn").addEventListener("click", async () => {
    const name = $("name-input").value.trim();
    if (name) store.set(K_NAME, name);
    activeDate = todayKey;
    isArchive = false;
    const played = store.get(K_PLAYED);
    if (played) {
      results = played.results;
      showResults(false);
      backfillPost(played).then(() => renderBoard());
      return;
    }
    startLoading();
  });

  // ── archive ─────────────────────────────────────────────────────────────
  const archiveKey = (dateKey) => `songsnap:archive:${dateKey}`;
  const sumResults = (r) => (r || []).reduce((s, x) => s + x.pts, 0);

  function showArchive() {
    stopAudio();
    const list = $("archive-list");
    list.innerHTML = "";
    const d = new Date();
    d.setDate(d.getDate() - 1); // past days only — today belongs to the daily
    let any = false;
    while (Date.parse(keyOf(d)) >= Date.parse(EPOCH)) {
      const dateKey = keyOf(d);
      any = true;
      const row = document.createElement("button");
      row.className = "archive-row";
      row.innerHTML = `<span class="archive-no"></span><span class="archive-date"></span><span class="archive-badge"></span>`;
      row.querySelector(".archive-no").textContent = `#${gameNoFor(dateKey)}`;
      row.querySelector(".archive-date").textContent = dateKey;
      const prev = store.get(archiveKey(dateKey)) || store.get(`songsnap:played:${dateKey}`);
      row.querySelector(".archive-badge").textContent =
        prev ? `${sumResults(prev.results)} pts` : "Play ▸";
      row.addEventListener("click", () => {
        activeDate = dateKey;
        isArchive = true;
        startLoading();
      });
      list.appendChild(row);
      d.setDate(d.getDate() - 1);
    }
    if (!any) {
      list.innerHTML = `<div class="board-empty">No past days yet — the archive opens tomorrow!</div>`;
    }
    show("screen-archive");
  }

  $("archive-btn").addEventListener("click", showArchive);
  $("results-archive-btn").addEventListener("click", showArchive);
  $("archive-back-btn").addEventListener("click", () => { initHome(); });

  // ── loading ─────────────────────────────────────────────────────────────
  async function startLoading() {
    show("screen-loading");
    $("loading-error").hidden = true;
    try {
      rounds = await buildDaily((found, cat) => {
        $("loading-status").textContent = `Finding today's tracks… ${found}/${ROUNDS}`;
        $("loading-cat").textContent = cat;
      });
      audios = rounds.map((r) => {
        const a = new Audio(r.media.previewUrl);
        a.preload = "auto";
        // If a baked preview URL has rotted, re-resolve it live and swap in
        // the fresh clip without interrupting the game.
        a.addEventListener("error", async () => {
          try {
            const fresh = await findPreview(r.song);
            r.media = fresh;
            a.src = fresh.previewUrl;
            a.load();
          } catch { /* round still playable — the guess window works without audio */ }
        }, { once: true });
        return a;
      });
      current = 0;
      results = [];
      startRound();
    } catch (err) {
      $("loading-status").textContent = "Couldn't load today's tracks.";
      $("loading-cat").textContent = "";
      $("loading-error").hidden = false;
    }
  }
  $("retry-btn").addEventListener("click", startLoading);

  // ── rounds ──────────────────────────────────────────────────────────────
  function startRound() {
    stopAudio();
    phase = "idle";
    const r = rounds[current];
    $("round-label").textContent =
      (isArchive ? `#${gameNoFor(activeDate)} · ` : "") + `Round ${current + 1} of ${ROUNDS}`;
    $("round-cat").textContent = r.song.c;
    $("round-score").textContent = `${totalScore()} pts`;
    $("play-btn").disabled = false;
    $("play-wrap").hidden = false;
    $("listen-wrap").hidden = true;
    $("guess-wrap").hidden = true;
    $("reveal-wrap").hidden = true;
    $("options").innerHTML = "";
    show("screen-round");
  }

  $("play-btn").addEventListener("click", () => {
    if (phase !== "idle") return;
    phase = "listening";
    $("play-btn").disabled = true;
    $("play-wrap").hidden = true;
    $("listen-wrap").hidden = false;
    const a = audios[current];
    a.currentTime = 0;
    const started = a.play().catch(() => {
      // Autoplay/load hiccup: fall through to the guess phase anyway so the
      // game never soft-locks; the bar still runs the full 5 seconds.
    });
    const t0 = performance.now();
    clipTimer = setInterval(() => {
      const sec = (performance.now() - t0) / 1000;
      $("listen-bar").style.width = `${Math.min(100, (sec / CLIP_SECONDS) * 100)}%`;
      $("listen-count").textContent = Math.max(0, Math.ceil(CLIP_SECONDS - sec));
      if (sec >= CLIP_SECONDS) {
        clearInterval(clipTimer);
        clipTimer = null;
        try { a.pause(); } catch { /* fine */ }
        startGuess();
      }
    }, 50);
    void started;
  });

  function pointsNow(elapsedMs) {
    const base = Math.max(0, MAX_ROUND_POINTS - Math.floor(elapsedMs / 1000) * 10);
    return Math.max(0, base - (hintUsed ? HINT_COST : 0));
  }

  // A written hint that narrows things down without naming the answer: the
  // release year plus the album — unless the album is basically the song
  // title, in which case fall back to the artist's first letter.
  function hintText(r) {
    const bits = [];
    if (r.media.year) bits.push(`released in ${r.media.year}`);
    const album = r.media.album || "";
    const nt = norm(r.song.t);
    const nal = norm(album);
    if (album && !nal.includes(nt) && !nt.includes(nal)) {
      bits.push(`from the album “${album}”`);
    } else {
      bits.push(`the artist's name starts with “${r.song.a.replace(/^the /i, "")[0].toUpperCase()}”`);
    }
    return `💡 This one was ${bits.join(" — ")}.`;
  }

  function eliminateTwo() {
    eliminated = true;
    const r = rounds[current];
    for (const b of document.querySelectorAll("#options .option")) {
      const hitIt = r.eliminate.some(
        (d) => b.querySelector(".opt-title").textContent === d.t &&
               b.querySelector(".opt-artist").textContent === d.a
      );
      if (hitIt) { b.classList.add("eliminated"); b.disabled = true; }
    }
  }

  function startGuess() {
    phase = "guessing";
    hintUsed = false;
    eliminated = false;
    $("listen-wrap").hidden = true;
    $("guess-wrap").hidden = false;
    $("hint-box").hidden = true;
    $("hint-box").textContent = "";
    $("hint-btn").disabled = false;
    const r = rounds[current];
    const box = $("options");
    box.innerHTML = "";
    r.options.forEach((opt) => {
      const b = document.createElement("button");
      b.className = "option";
      b.innerHTML = `<span class="opt-title"></span><span class="opt-artist"></span>`;
      b.querySelector(".opt-title").textContent = opt.t;
      b.querySelector(".opt-artist").textContent = opt.a;
      b.addEventListener("click", () => answer(opt));
      box.appendChild(b);
    });
    guessStart = performance.now();
    guessTimer = setInterval(() => {
      const ms = performance.now() - guessStart;
      $("guess-bar").style.width = `${Math.max(0, 100 - (ms / (GUESS_SECONDS * 1000)) * 100)}%`;
      $("points-ticker").textContent = pointsNow(ms);
      if (ms >= ELIMINATE_AT_MS && !eliminated) eliminateTwo();
      if (ms >= GUESS_SECONDS * 1000) answer(null);
    }, 50);
  }

  // Replay the 5-second clip while the clock keeps running; options stay live.
  $("replay-btn").addEventListener("click", () => {
    if (phase !== "guessing") return;
    const a = audios[current];
    clearInterval(replayTimer);
    a.currentTime = 0;
    a.play().catch(() => { /* best-effort */ });
    replayTimer = setInterval(() => {
      if (a.currentTime >= CLIP_SECONDS) {
        clearInterval(replayTimer);
        replayTimer = null;
        try { a.pause(); } catch { /* fine */ }
      }
    }, 100);
  });

  $("hint-btn").addEventListener("click", () => {
    if (phase !== "guessing" || hintUsed) return;
    hintUsed = true;
    $("hint-btn").disabled = true;
    const box = $("hint-box");
    box.textContent = hintText(rounds[current]);
    box.hidden = false;
  });

  function answer(opt) {
    if (phase !== "guessing") return;
    phase = "reveal";
    clearInterval(guessTimer);
    clearInterval(replayTimer);
    guessTimer = replayTimer = null;
    const ms = performance.now() - guessStart;
    const r = rounds[current];
    const correct = opt && opt.t === r.song.t && opt.a === r.song.a;
    const outcome = opt == null ? "timeout" : correct ? "hit" : "miss";
    const pts = correct ? pointsNow(ms) : 0;
    results.push({
      t: r.song.t, a: r.song.a, art: r.media.artwork, year: r.media.year,
      pts, outcome,
    });

    // paint the option buttons
    for (const b of document.querySelectorAll("#options .option")) {
      b.disabled = true;
      const isAnswer = b.querySelector(".opt-title").textContent === r.song.t &&
                       b.querySelector(".opt-artist").textContent === r.song.a;
      if (isAnswer) b.classList.add("right");
      else if (opt && b.querySelector(".opt-title").textContent === opt.t &&
               b.querySelector(".opt-artist").textContent === opt.a) b.classList.add("wrong");
    }
    $("guess-bar").style.width = "0%";

    // reveal card — let the preview keep playing while they look at it
    $("reveal-art").src = r.media.artwork || "";
    $("reveal-title").textContent = r.song.t;
    $("reveal-artist").textContent = r.song.a + (r.media.year ? ` · ${r.media.year}` : "");
    $("reveal-pts").textContent =
      outcome === "hit" ? `+${pts} pts${hintUsed ? " (hint −30)" : ""}`
      : outcome === "timeout" ? "Time's up! +0" : "Wrong! +0";
    $("reveal-pts").className = `reveal-pts ${outcome}`;
    $("next-btn").textContent = current === ROUNDS - 1 ? "See results ➜" : "Next round ➜";
    $("reveal-wrap").hidden = false;
    audios[current].play().catch(() => { /* keep-playing is best-effort */ });
  }

  $("next-btn").addEventListener("click", () => {
    stopAudio();
    current++;
    if (current < ROUNDS) startRound();
    else finishGame();
  });

  // ── results, share, leaderboard ─────────────────────────────────────────
  async function finishGame() {
    if (isArchive) {
      // Archive runs are practice: remember the score for the archive list,
      // never touch the daily lock or leaderboard.
      store.set(archiveKey(activeDate), { results, ts: Date.now() });
      showResults(true);
      return;
    }
    // Lock the day and show results immediately; alias assignment and the
    // global post happen in the background so a slow network never stalls
    // the results screen.
    store.set(K_PLAYED, { results, name: playerName(), ts: Date.now() });
    showResults(true);
    const name = await ensureName();
    store.set(K_PLAYED, { results, name, ts: Date.now() });
    const board = store.get(K_BOARD) || [];
    board.push({ name, score: totalScore(), ts: Date.now() });
    store.set(K_BOARD, board);
    $("results-sub").textContent = `Nice one, ${name}!`;
    try {
      store.set(K_POSTED, await postScore(name, totalScore()));
      renderBoard();
    } catch { /* offline — backfilled on the next visit */ }
  }

  const OUTCOME_EMOJI = { hit: "✅", miss: "❌", timeout: "⏰" };

  function shareText() {
    const line = results.map((r) => `${OUTCOME_EMOJI[r.outcome]}${r.pts}`).join(" ");
    const url = location.origin.startsWith("http")
      ? location.origin + location.pathname
      : "";
    const tag = `#${gameNoFor(activeDate)}${isArchive ? " (archive)" : ""}`;
    return `🎵 SongSnap ${tag} — ${totalScore()}/500\n${line}\nCan you beat me?${url ? " " + url : ""}`;
  }

  function showResults(fresh) {
    stopAudio();
    $("final-score").textContent = totalScore();
    $("results-sub").textContent = isArchive
      ? `Archive #${gameNoFor(activeDate)} · ${activeDate}`
      : fresh
        ? `Nice one, ${playerName()}!`
        : `Your score today, ${playerName()}`;
    $("archive-note").hidden = !isArchive;
    $("board-section").hidden = isArchive;
    $("next-mix").hidden = isArchive;
    const list = $("results-rounds");
    list.innerHTML = "";
    results.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "result-row";
      row.innerHTML = `
        <img class="result-art" alt="">
        <div class="result-meta">
          <div class="result-title"></div>
          <div class="result-artist"></div>
        </div>
        <div class="result-pts"></div>`;
      row.querySelector(".result-art").src = r.art || "";
      row.querySelector(".result-title").textContent = `${i + 1}. ${r.t}`;
      row.querySelector(".result-artist").textContent = r.a;
      row.querySelector(".result-pts").textContent = `${OUTCOME_EMOJI[r.outcome]} ${r.pts}`;
      list.appendChild(row);
    });
    if (!isArchive) {
      $("board").innerHTML = "";
      renderBoard();
      startCountdown();
      // Keep the board fresh while the player lingers — friends finish later.
      clearInterval(boardTimer);
      boardTimer = setInterval(() => {
        if ($("screen-results").classList.contains("active") && !isArchive) renderBoard();
      }, 30000);
    }
    show("screen-results");
  }
  let boardTimer = null;

  $("share-btn").addEventListener("click", async () => {
    const text = shareText();
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
      throw new Error("no web share");
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        toast("Result copied — paste it to a friend!");
      } catch {
        prompt("Copy your result:", text);
      }
    }
  });

  let boardRenderToken = 0;
  async function renderBoard() {
    const token = ++boardRenderToken;
    const el = $("board");
    if (!el.children.length) el.innerHTML = `<div class="board-empty">Loading scores…</div>`;

    let entries = null;
    let global = false;
    try {
      const res = await dbFetch(`${DB_BASE}/boards/${todayKey}.json`);
      if (res.ok) {
        const data = (await res.json()) || {};
        entries = Object.entries(data).map(([key, v]) => ({ key, ...v }));
        global = true;
      }
    } catch { /* offline — local fallback below */ }
    if (token !== boardRenderToken) return; // a newer render superseded this one
    if (!entries) {
      entries = (store.get(K_BOARD) || []).map((e, i) => ({ key: `local${i}`, ...e }));
    }
    $("board-note").textContent = global ? "(all players)" : "(offline — this device only)";

    entries.sort((x, y) => y.score - x.score || (x.ts || 0) - (y.ts || 0));
    el.innerHTML = "";
    if (!entries.length) {
      el.innerHTML = `<div class="board-empty">No scores yet today — be the first!</div>`;
      return;
    }
    const mine = store.get(K_POSTED);
    const medals = ["🥇", "🥈", "🥉"];
    const addRow = (e, rank) => {
      const row = document.createElement("div");
      row.className = "board-row" + (e.key === mine ? " me" : "");
      row.innerHTML = `<span class="board-rank"></span><span class="board-name"></span><span class="board-score"></span>`;
      row.querySelector(".board-rank").textContent = medals[rank] || `${rank + 1}.`;
      row.querySelector(".board-name").textContent = e.name;
      row.querySelector(".board-score").textContent = e.score;
      el.appendChild(row);
    };
    entries.slice(0, 10).forEach(addRow);
    const myRank = mine ? entries.findIndex((e) => e.key === mine) : -1;
    if (myRank >= 10) {
      const dots = document.createElement("div");
      dots.className = "board-empty";
      dots.textContent = "⋯";
      el.appendChild(dots);
      addRow(entries[myRank], myRank);
    }
  }

  let countdownTimer = null;
  function startCountdown() {
    const el = $("next-mix");
    const tick = () => {
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const ms = midnight - now;
      const p = (n) => String(n).padStart(2, "0");
      el.textContent = `Next daily mix in ${p(Math.floor(ms / 36e5))}:${p(Math.floor(ms / 6e4) % 60)}:${p(Math.floor(ms / 1e3) % 60)}`;
    };
    tick();
    clearInterval(countdownTimer);
    countdownTimer = setInterval(tick, 1000);
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  initHome();
})();
