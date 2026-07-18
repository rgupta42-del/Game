/**
 * SongSnap — daily 5-round song-guessing game.
 *
 * Flow: pick 5 deterministic daily songs (seeded by local date) → fetch
 * official 30s iTunes preview clips at runtime → each round plays the first
 * 5 seconds of the clip, then a 10-second guess window opens with 5 options.
 * Points: answer in the 1st second = 100, 2nd = 90 … window expires = 0.
 * Wrong answer = 0. Results are shareable and saved to a per-day, on-device
 * leaderboard.
 */
"use strict";
(() => {
  const CLIP_SECONDS = 5;
  const GUESS_SECONDS = 10;
  const ROUNDS = 5;
  const OPTIONS = 5;
  const MAX_ROUND_POINTS = 100;
  const MAX_PER_CATEGORY = 2; // variety guard for the daily five
  const EPOCH = "2026-07-18"; // game #1

  const $ = (id) => document.getElementById(id);
  const todayKey = (() => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();
  const gameNo =
    Math.max(1, Math.round((Date.parse(todayKey) - Date.parse(EPOCH)) / 864e5) + 1);

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
  const K_PLAYED = `songsnap:played:${todayKey}`;
  const K_BOARD = `songsnap:board:${todayKey}`;

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
    };
  }

  // ── daily puzzle assembly ───────────────────────────────────────────────
  // Walk the seeded shuffle of the pool (≤2 per category) and keep the first
  // five songs whose iTunes preview actually resolves — deterministic even
  // when a lookup fails, since everyone walks the same order.
  async function buildDaily(onProgress) {
    const rng = seededRng(`songsnap:${todayKey}`);
    const order = seededShuffle(SONG_POOL, rng);
    const rounds = [];
    const catCount = {};
    const chosenTitles = new Set();

    for (const song of order) {
      if (rounds.length >= ROUNDS) break;
      if ((catCount[song.c] || 0) >= MAX_PER_CATEGORY) continue;
      onProgress(rounds.length, song.c);
      try {
        const media = await findPreview(song);
        catCount[song.c] = (catCount[song.c] || 0) + 1;
        chosenTitles.add(song.t + "|" + song.a);
        rounds.push({ song, media });
      } catch { /* preview unavailable — walk on to the next candidate */ }
    }
    if (rounds.length < ROUNDS) throw new Error("not enough previews");

    // 4 same-category decoys per round, deterministic per date+round.
    rounds.forEach((round, i) => {
      const rr = seededRng(`songsnap:${todayKey}:r${i}`);
      const decoys = seededShuffle(
        SONG_POOL.filter(
          (s) => s.c === round.song.c && !chosenTitles.has(s.t + "|" + s.a)
        ),
        rr
      ).slice(0, OPTIONS - 1);
      round.options = seededShuffle([round.song, ...decoys], rr);
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
  let guessStart = 0;
  let phase = "idle";     // idle | listening | guessing | reveal

  const totalScore = () => results.reduce((s, r) => s + r.pts, 0);
  const playerName = () => (store.get(K_NAME) || "Player").slice(0, 20);

  function show(id) {
    for (const s of document.querySelectorAll(".screen")) s.classList.remove("active");
    $(id).classList.add("active");
  }

  function stopAudio() {
    for (const a of audios) { try { a.pause(); } catch { /* not started */ } }
    clearInterval(clipTimer);
    clearInterval(guessTimer);
    clipTimer = guessTimer = null;
  }

  // ── home ────────────────────────────────────────────────────────────────
  function initHome() {
    $("game-no").textContent = `#${gameNo} · ${todayKey}`;
    $("name-input").value = store.get(K_NAME) || "";
    const played = store.get(K_PLAYED);
    if (played) {
      $("start-btn").textContent = "See today's results";
      $("home-note").textContent = "You've already played today — new mix at midnight!";
    }
    show("screen-home");
  }

  $("start-btn").addEventListener("click", () => {
    const name = $("name-input").value.trim();
    if (name) store.set(K_NAME, name);
    const played = store.get(K_PLAYED);
    if (played) { results = played.results; showResults(false); return; }
    startLoading();
  });

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
    $("round-label").textContent = `Round ${current + 1} of ${ROUNDS}`;
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
    return Math.max(0, MAX_ROUND_POINTS - Math.floor(elapsedMs / 1000) * 10);
  }

  function startGuess() {
    phase = "guessing";
    $("listen-wrap").hidden = true;
    $("guess-wrap").hidden = false;
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
      if (ms >= GUESS_SECONDS * 1000) answer(null);
    }, 50);
  }

  function answer(opt) {
    if (phase !== "guessing") return;
    phase = "reveal";
    clearInterval(guessTimer);
    guessTimer = null;
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
      outcome === "hit" ? `+${pts} pts` : outcome === "timeout" ? "Time's up! +0" : "Wrong! +0";
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
  function finishGame() {
    store.set(K_PLAYED, { results, name: playerName(), ts: Date.now() });
    const board = store.get(K_BOARD) || [];
    board.push({ name: playerName(), score: totalScore(), ts: Date.now() });
    store.set(K_BOARD, board);
    showResults(true);
  }

  const OUTCOME_EMOJI = { hit: "✅", miss: "❌", timeout: "⏰" };

  function shareText() {
    const line = results.map((r) => `${OUTCOME_EMOJI[r.outcome]}${r.pts}`).join(" ");
    const url = location.origin.startsWith("http")
      ? location.origin + location.pathname
      : "";
    return `🎵 SongSnap #${gameNo} — ${totalScore()}/500\n${line}\nCan you beat me?${url ? " " + url : ""}`;
  }

  function showResults(fresh) {
    stopAudio();
    $("final-score").textContent = totalScore();
    $("results-sub").textContent = fresh
      ? `Nice one, ${playerName()}!`
      : `Your score today, ${playerName()}`;
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
    renderBoard();
    startCountdown();
    show("screen-results");
  }

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

  function renderBoard() {
    const board = (store.get(K_BOARD) || [])
      .slice()
      .sort((x, y) => y.score - x.score || x.ts - y.ts);
    const el = $("board");
    el.innerHTML = "";
    if (!board.length) {
      el.innerHTML = `<div class="board-empty">No scores yet today.</div>`;
      return;
    }
    const medals = ["🥇", "🥈", "🥉"];
    board.slice(0, 10).forEach((e, i) => {
      const row = document.createElement("div");
      row.className = "board-row";
      row.innerHTML = `<span class="board-rank"></span><span class="board-name"></span><span class="board-score"></span>`;
      row.querySelector(".board-rank").textContent = medals[i] || `${i + 1}.`;
      row.querySelector(".board-name").textContent = e.name;
      row.querySelector(".board-score").textContent = e.score;
      el.appendChild(row);
    });
  }

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
    setInterval(tick, 1000);
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
