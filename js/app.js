/**
 * UI controller for the NBA Re-Draft game.
 * Ties together the player pool, the snake-draft engine and the analytics
 * engine, and renders the setup / draft / results screens.
 */

(function () {
  "use strict";

  const { careerRating, peakOverall, pickFitGrade, evaluateRoster, playoffLabel, playerTier } = SCORING;
  const tierBadge = (p) => {
    const t = playerTier(p);
    return `<span class="tier tier-${t.n}" title="Tier ${t.n} — ${t.label}">${t.short}</span>`;
  };

  // ---- DOM helpers -------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  };
  const showScreen = (id) => {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    $(id).classList.add("active");
    // Screen changes always start at the top — otherwise results (or a new
    // screen) appear scrolled to wherever the previous screen left off.
    if (typeof window.scrollTo === "function") window.scrollTo(0, 0);
  };

  // ---- Game state --------------------------------------------------------
  let game = null;
  const ui = {
    posFilter: "ALL",
    search: "",
    sortBy: "career",
    mode: "local", // "local" | "online"
    online: false,
    live: false, // true when using Firebase real-time sync
    roomId: null,
    mySeat: null, // which manager index this device controls (live mode)
    isHost: false, // creator of a live room — drives CPU picks
    roomReady: true, // (live) becomes true once the room exists
    cpuFlags: [], // which seats are CPU-controlled
    staticBuilt: false,
    gameGen: 0, // generation counter so stale CPU timers can't fire into a new game
    pendingPlayer: null, // player awaiting slot assignment in the modal
    clockSeconds: 60, // pick clock length (0 = off)
    capMode: false, // salary-cap drafting
    capChoice: null, // chosen cap amount (150..250); null = auto by coach mode
    posMode: "locked", // "locked" | "flexible" position assignment
    coachMode: false, // draft a head coach (a sixth, anytime slot)
    orderMode: "snake", // "snake" | "linear" | "random"
    auctionMode: false, // auction draft (nominate + bid); forces salary cap
    cpuPace: "fast", // "fast" | "slow" — spacing between CPU bids/picks
    auction: null, // live auction state: { pid, bid, leaderId, deadline, timer }
    paused: false, // draft paused (freezes clocks + CPU acting)
    resultTeam: 0, // which team's analysis is shown on the results screen
    challenge: "none", // "none" | "nostars" | "daily60"
    chalSeed: null, // date seed for daily60 (travels in links/rooms)
    queue: [], // player ids starred by THIS device (auto-pick prefers these)
    lastReactKey: null, // newest reaction already animated (live rooms)
    draftOrder: null, // explicit pick order (persisted for random-order replay)
    turnGatePick: null, // pickLog length for which the on-clock human pressed "Go"
    finalShown: false, // final-standings popup shown for this game
    announcedCount: null, // picks already announced via the pick toast
    activeTab: "players", // draft-room tab: "players" | "board" | "teams"
    lastPickSeen: -1, // pickLog length at last render (drives snap-back-to-players)
    allowedEras: ["80s", "90s", "00s", "10s", "20s"],
  };
  const eraAllowed = (p) => (p.eras || []).some((d) => ui.allowedEras.includes(d));

  // ---- Challenge modes -----------------------------------------------------
  let _dailySet = null; // cached Set of ids for the current daily60 seed
  function dailySet() {
    if (_dailySet) return _dailySet;
    const seed = ui.chalSeed || new Date().toISOString().slice(0, 10);
    const rnd = POSTSEASON.mulberry32(POSTSEASON.hashStr("daily60·" + seed));
    // Seeded shuffle, then take 60 while guaranteeing position coverage.
    const pool = PLAYER_POOL.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const set = new Set();
    STARTER_SLOTS.forEach((pos) => {
      pool.filter((p) => p.eligible.includes(pos)).slice(0, 10).forEach((p) => set.add(p.id));
    });
    for (const p of pool) {
      if (set.size >= 60) break;
      set.add(p.id);
    }
    _dailySet = set;
    return set;
  }
  /** Era filter + challenge-mode filter, applied everywhere the pool is read. */
  function poolAllowed(p) {
    if (!eraAllowed(p)) return false;
    if (ui.challenge === "nostars") return SCORING.careerRating(p) <= 85;
    if (ui.challenge === "daily60") return dailySet().has(p.id);
    return true;
  }
  const salaryOf = (p) => (p.isCoach ? SCORING.coachSalary(p) : SCORING.salaryValue(p));
  // Chosen cap, defaulting to $250 with coaches / $200 without.
  const capAmount = () => ui.capChoice || (ui.coachMode ? SCORING.SALARY_CAP_WITH_COACH : SCORING.SALARY_CAP);
  const managerSpent = (m) => {
    // Auction drafts spend real hammer prices; classic drafts use curve salaries.
    if (game && game.auction) {
      return game.pickLog.filter((e) => e.managerId === m.id).reduce((s, e) => s + (e.price || 0), 0);
    }
    return (
      SCORING.starterPlayers({ starters: m.starters, bench: [] }).reduce((s, p) => s + salaryOf(p), 0) +
      (m.coach ? salaryOf(m.coach) : 0)
    );
  };
  // Suggested auction value: the curve salary as a % of a $200 cap, scaled to
  // the chosen cap — so a $72 Jokić proposes at $90 under a $250 cap.
  const proposedValue = (p) => Math.max(1, Math.round(salaryOf(p) * (capAmount() / 200)));
  // Look up either a player or a coach by id (for replaying encoded drafts).
  const findDraftable = (id) =>
    PLAYER_POOL.find((x) => x.id === id) ||
    (typeof COACH_POOL !== "undefined" ? COACH_POOL.find((x) => x.id === id) : null);

  const injuryDot = (risk) => {
    if (risk >= 60) return `<span class="injury-dot" title="High injury risk (${risk})">🔴</span>`;
    if (risk >= 38) return `<span class="injury-dot" title="Moderate injury risk (${risk})">🟡</span>`;
    return `<span class="injury-dot" title="Low injury risk (${risk})">🟢</span>`;
  };

  // ========================================================================
  //  SETUP SCREEN
  // ========================================================================
  function initSetup() {
    const numSel = $("#num-managers");
    numSel.innerHTML = "";
    for (let i = 2; i <= 8; i++) {
      const o = el("option", null, `${i} managers`);
      o.value = i;
      if (i === 4) o.selected = true;
      numSel.appendChild(o);
    }

    // Era (decade) filter chips — all on by default.
    const eraWrap = $("#era-filters");
    eraWrap.innerHTML = "";
    ["80s", "90s", "00s", "10s", "20s"].forEach((d) => {
      const lab = el("label", "era-chip on");
      const cb = el("input");
      cb.type = "checkbox";
      cb.value = d;
      cb.checked = true;
      cb.addEventListener("change", () => lab.classList.toggle("on", cb.checked));
      lab.appendChild(cb);
      lab.appendChild(el("span", null, d));
      eraWrap.appendChild(lab);
    });

    renderManagerNameInputs();
    numSel.addEventListener("change", renderManagerNameInputs);
    $("#start-draft").addEventListener("click", startDraft);

    const goHome = (e) => {
      if (e) e.preventDefault();
      // Confirm before discarding a draft that's actually in progress.
      const inDraft = game && !game.isComplete && $("#draft-screen").classList.contains("active");
      if (inDraft && !confirm("Leave the current draft and start over from scratch?")) return;
      // Clear any shared/room link state and reload to a fresh setup screen.
      history.replaceState(null, "", location.pathname + location.search);
      location.reload();
    };
    $("#home-btn").addEventListener("click", goHome);
    $("#home-link").addEventListener("click", goHome);

    $("#mode-select").addEventListener("change", (e) => {
      ui.mode = e.target.value;
      $("#mode-hint").textContent =
        ui.mode === "online"
          ? "Each human manager joins on their own device; tick 🤖 for CPU seats (the host's device runs them automatically). Mix humans and CPUs freely."
          : "Everyone drafts on this device, taking turns. Tick 🤖 for CPU seats.";
      $("#start-draft").textContent = ui.mode === "online" ? "Start Online Draft" : "Start Draft";
      renderManagerNameInputs();
    });

    // Salary-cap amount: only relevant in cap mode; default tracks coach mode
    // ($250 with a coach, $200 without) until the user picks a value themselves.
    // AUCTION drafts require a cap, so selecting Auction checks + locks it on
    // and forces the cap-amount picker open.
    let capTouched = false;
    const syncCapUI = () => {
      const auction = $("#order-select").value === "auction";
      if (auction) $("#cap-toggle").checked = true;
      $("#cap-toggle").disabled = auction;
      $("#cap-amount-field").classList.toggle("hidden", !$("#cap-toggle").checked && !auction);
      if (!capTouched) $("#cap-amount").value = $("#coach-toggle").checked ? "250" : "200";
    };
    $("#cap-toggle").addEventListener("change", syncCapUI);
    $("#coach-toggle").addEventListener("change", syncCapUI);
    $("#order-select").addEventListener("change", syncCapUI);
    $("#cap-amount").addEventListener("change", () => { capTouched = true; });
    syncCapUI();

    // Sound: browsers require a user gesture before audio — unlock on the
    // first tap anywhere. The 🔊 toggle persists across sessions.
    document.addEventListener("click", () => SFX.unlock(), { once: true });
    const muteBtn = $("#mute-btn");
    const paintMute = () => (muteBtn.textContent = SFX.muted ? "🔇" : "🔊");
    muteBtn.addEventListener("click", () => { SFX.toggle(); paintMute(); });
    paintMute();
    $("#pause-btn").addEventListener("click", togglePause);
  }

  // ---- Online state (share-a-link relay) ---------------------------------
  const b64urlEncode = (s) =>
    btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const b64urlDecode = (s) =>
    decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

  function encodeGameState() {
    const state = {
      n: game.managers.map((m) => m.name),
      // Auction picks need the winner + hammer price to replay (ownership
      // doesn't follow the pick order); classic picks just need id + slot.
      p: game.pickLog.map((e) =>
        game.auction ? [e.player.id, e.slot, e.price || 0, e.managerId] : [e.player.id, e.slot]
      ),
      cfg: currentConfig(),
      cpu: game.managers.map((m) => (m.isCpu ? 1 : 0)),
    };
    return b64urlEncode(JSON.stringify(state));
  }

  /** Persist the current online game into the URL (no history spam). */
  function pushOnlineState() {
    if (!ui.online) return;
    history.replaceState(null, "", "#g=" + encodeGameState());
  }

  /** Rebuild a game from a URL hash, replaying every pick. Returns true if loaded. */
  function loadFromHash() {
    const m = location.hash.match(/[#&]g=([^&]+)/);
    if (!m) return false;
    try {
      const state = JSON.parse(b64urlDecode(m[1]));
      ui.online = true;
      ui.mode = "online";
      ui.cpuFlags = (state.cpu || []).map(Boolean);
      applyConfig(state.cfg);
      rebuildGameFrom(state.n, state.p || [], ui.cpuFlags);
      initCpuProfiles(); // this device drives CPU picks while it holds the link
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---- Live sync (Firebase Realtime Database) ----------------------------
  const liveAvailable = () => !!(window.FBSync && window.FBSync.available());
  const randomRoomId = () =>
    Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
  const seatKey = (roomId) => "nbaredraft_seat_" + roomId;

  function rebuildGameFrom(names, picks, cpuFlags) {
    game = new DraftGame(names, {
      benchSize: 0,
      cpuFlags: cpuFlags || ui.cpuFlags || [],
      posMode: ui.posMode,
      coachMode: ui.coachMode,
      orderMode: ui.orderMode,
      auction: ui.auctionMode,
      order: ui.draftOrder, // exact order for random-mode replay (else rebuilt)
    });
    // Capture the order the first time (random mode) so it persists for replay.
    if (!ui.draftOrder) ui.draftOrder = game.order.slice();
    (picks || []).forEach((pk) => {
      // pk may be [id, slot] / [id, slot, price, mgrId] or a Firebase object.
      const p = findDraftable(pk[0]);
      if (!p || game.isComplete) return;
      try {
        game.draft(p, pk[1], game.auction ? { price: pk[2] || 0, forId: pk[3] } : undefined);
      } catch (e) {
        /* skip a malformed/duplicate pick rather than break the whole replay */
      }
    });
  }

  /** Host: create a live room, then choose a seat (any pick slot), start watching. */
  function startLiveDraft(names, cpuFlags) {
    ui.online = true;
    ui.live = true;
    ui.isHost = true; // the host's device runs all CPU seats
    ui.roomReady = false; // don't drive CPU picks until the room exists
    ui.roomId = randomRoomId();
    ui.mySeat = null; // host chooses their (human) seat
    ui.cpuFlags = cpuFlags || [];
    ui.gameGen++;
    ui.finalShown = false;
    rebuildGameFrom(names, [], ui.cpuFlags);
    initCpuProfiles();
    buildDraftStaticUI();
    ui.staticBuilt = true;
    showScreen("#draft-screen");
    renderDraft();
    FBSync.create(ui.roomId, { names, picks: [], seats: {}, cfg: currentConfig(), cpu: ui.cpuFlags.map((f) => (f ? 1 : 0)) })
      .then(() => {
        ui.roomReady = true;
        history.replaceState(null, "", "#room=" + ui.roomId);
        // Room link FIRST — share it with your friends before anything else
        // (no clock is running; the draft waits). Seat choice comes after.
        showShareGate(location.href, () => showSeatModal(names, {}));
        FBSync.watch(ui.roomId, onRoomUpdate);
      })
      .catch((e) => {
        // Couldn't reach Firebase — degrade to the link-relay so the draft still works.
        console.error(e);
        ui.live = false;
        alert(
          "Couldn't reach the live database, so this draft fell back to the " +
          "shareable-link relay. Check your Firebase Realtime Database rules " +
          "(see FIREBASE_SETUP.md). The draft still works via the relay."
        );
        ui.mySeat = null;
        pushOnlineState();
        renderDraft();
      });
  }

  /** Joiner: open an existing live room and start watching. */
  function joinLiveRoom(roomId) {
    ui.online = true;
    ui.live = true;
    ui.isHost = false; // joiners never drive CPU seats
    ui.roomId = roomId;
    const saved = localStorage.getItem(seatKey(roomId));
    ui.mySeat = saved != null ? parseInt(saved, 10) : null;
    ui.gameGen++;
    FBSync.watch(roomId, onRoomUpdate);
  }

  /** Authoritative state changed in the room — rebuild and re-render for everyone. */
  function onRoomUpdate(data) {
    if (!data) return;
    const names = data.names || [];
    let picks = data.picks || [];
    if (!Array.isArray(picks)) picks = Object.values(picks); // Firebase array quirk
    applyConfig(data.cfg);
    if (Array.isArray(data.cpu)) ui.cpuFlags = data.cpu.map(Boolean);
    ui.gameGen++; // invalidate any pending timers
    rebuildGameFrom(names, picks, ui.cpuFlags);
    syncLiveAuction(data.auction || null);
    // Room-wide pause: everyone freezes together.
    const roomPaused = !!data.paused;
    if (roomPaused !== ui.paused) {
      ui.paused = roomPaused;
      $("#pause-btn").textContent = roomPaused ? "▶" : "⏸";
      $("#pause-banner").classList.toggle("hidden", !roomPaused);
    }

    if (!ui.staticBuilt) {
      buildDraftStaticUI();
      ui.staticBuilt = true;
    }
    // First-time human joiner picks which (non-CPU) seat they are.
    if (ui.mySeat == null && names.length) {
      showSeatModal(names, data.seats || {});
    }
    if (game.isComplete) {
      showResults();
    } else {
      showScreen("#draft-screen");
      renderDraft();
      if (ui.auction && ui.auction.live) {
        startLiveAuctionTicker();
        hostDriveAuctionCpus();
      }
    }
    handleReactions(data);
  }

  function showSeatModal(names, takenSeats) {
    const wrap = $("#seat-options");
    wrap.innerHTML = "";
    const takenIdx = new Set(Object.keys(takenSeats || {}).map((k) => parseInt(k, 10)));
    names.forEach((nm, i) => {
      const isCpuSeat = (ui.cpuFlags || [])[i];
      const taken = takenIdx.has(i) && String(i) !== localStorage.getItem(seatKey(ui.roomId));
      const locked = isCpuSeat || taken;
      const o = el("div", "so", `${nm}${isCpuSeat ? " 🤖" : taken ? " (taken)" : ""}`);
      if (locked) o.style.opacity = "0.5";
      else
        o.onclick = () => {
          ui.mySeat = i;
          localStorage.setItem(seatKey(ui.roomId), String(i));
          FBSync.claimSeat(ui.roomId, i, nm);
          $("#seat-modal").classList.add("hidden");
          renderDraft();
        };
      wrap.appendChild(o);
    });
    $("#seat-modal").classList.remove("hidden");
  }

  /** Share-first gate: the invite link, up front, before the draft engages. */
  function showShareGate(link, onContinue) {
    $("#sharegate-link").value = link;
    $("#sharegate-copy").onclick = () => {
      const btn = $("#sharegate-copy");
      const done = () => {
        btn.textContent = "✅ Copied";
        setTimeout(() => (btn.textContent = "Copy"), 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(done, () => prompt("Copy this link:", link));
      } else {
        prompt("Copy this link:", link);
      }
    };
    $("#sharegate-continue").textContent = onContinue ? "Continue → choose my seat" : "Continue to the draft ▶";
    $("#sharegate-continue").onclick = () => {
      $("#sharegate-modal").classList.add("hidden");
      if (onContinue) onContinue();
    };
    $("#sharegate-modal").classList.remove("hidden");
  }

  /** Is it this device's turn to draft? (Always yes outside live mode.) */
  function myTurn() {
    if (!ui.live) return true;
    const m = game.currentManager();
    return m && m.id === ui.mySeat;
  }

  function renderManagerNameInputs() {
    const n = parseInt($("#num-managers").value, 10);
    const wrap = $("#manager-names");
    // Preserve any values/CPU toggles already entered across re-renders.
    const prevName = {};
    const prevCpu = {};
    wrap.querySelectorAll(".mn-row").forEach((row, i) => {
      prevName[i] = row.querySelector('input[type="text"]').value;
      // The CPU checkbox isn't rendered in online mode — guard against null so
      // changing the manager count doesn't throw and abort the rebuild.
      const cb = row.querySelector('input[type="checkbox"]');
      prevCpu[i] = cb ? cb.checked : false;
    });
    wrap.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const row = el("div", "mn-row");
      row.appendChild(el("label", null, `Seat ${i + 1}`));

      const inp = el("input");
      inp.type = "text";
      inp.placeholder = prevCpu[i] ? `CPU ${i + 1}` : `Manager ${i + 1}`;
      inp.value = prevName[i] || "";
      row.appendChild(inp);

      // CPU seats are available in both local and online drafts.
      const cpuLabel = el("label", "cpu-toggle");
      const cb = el("input");
      cb.type = "checkbox";
      cb.checked = !!prevCpu[i];
      cpuLabel.appendChild(cb);
      cpuLabel.appendChild(el("span", null, "🤖 CPU controls this seat"));
      cb.addEventListener("change", () => {
        inp.placeholder = cb.checked ? `CPU ${i + 1}` : `Manager ${i + 1}`;
      });
      row.appendChild(cpuLabel);

      wrap.appendChild(row);
    }
  }

  /** Ensure the chosen eras leave enough players to fill every position. */
  function validateEraPool(numManagers) {
    for (const pos of STARTER_SLOTS) {
      const n = PLAYER_POOL.filter((p) => poolAllowed(p) && p.eligible.includes(pos)).length;
      if (n < numManagers) {
        return `Not enough ${pos}s in the selected eras (${n}) for ${numManagers} managers. Pick more decades.`;
      }
    }
    return null;
  }

  function startDraft() {
    const rows = Array.from($("#manager-names").querySelectorAll(".mn-row"));
    const names = rows.map((r) => r.querySelector('input[type="text"]').value);
    const online = ui.mode === "online";

    // Read setup options.
    ui.clockSeconds = parseInt($("#clock-select").value, 10) || 0;
    ui.capMode = $("#cap-toggle").checked;
    ui.posMode = $("#posmode-select").value === "flexible" ? "flexible" : "locked";
    ui.coachMode = $("#coach-toggle").checked;
    ui.capChoice = parseInt($("#cap-amount").value, 10) || null;
    ui.cpuPace = $("#cpupace-select").value === "slow" ? "slow" : "fast";
    const orderSel = $("#order-select").value;
    ui.auctionMode = orderSel === "auction";
    ui.orderMode = ["snake", "linear", "random"].includes(orderSel) ? orderSel : "linear";
    if (ui.auctionMode) {
      ui.capMode = true; // auctions REQUIRE a salary cap
      if (!ui.capChoice) ui.capChoice = ui.coachMode ? 250 : 200;
      if (online && !liveAvailable()) {
        return alert("🔨 Online auctions need real-time sync (Firebase) — the shareable-link relay can't run live bidding. Configure Firebase (see FIREBASE_SETUP.md) or run a Local auction.");
      }
    }
    ui.allowedEras = Array.from($("#era-filters").querySelectorAll("input:checked")).map((c) => c.value);
    if (ui.allowedEras.length === 0) return alert("Select at least one era.");
    ui.challenge = $("#challenge-select").value || "none";
    ui.chalSeed = ui.challenge === "daily60" ? new Date().toISOString().slice(0, 10) : null;
    _dailySet = null; // recompute for this game's seed
    const eraErr = validateEraPool(names.length);
    if (eraErr) return alert(eraErr);

    // CPU flags from the per-seat toggles (available in local AND online).
    const cpuFlags = rows.map((r) => {
      const cb = r.querySelector('input[type="checkbox"]');
      return cb ? cb.checked : false;
    });
    ui.cpuFlags = cpuFlags;
    ui.draftOrder = null; // fresh draft — let the engine build the order
    // Live online draft via Firebase when configured; otherwise link-relay.
    if (online && liveAvailable()) {
      startLiveDraft(names, cpuFlags);
      return;
    }

    ui.online = online;
    ui.gameGen++;
    ui.finalShown = false;
    ui.auction = null;
    ui.queue = [];
    game = new DraftGame(names, {
      benchSize: 0, cpuFlags, posMode: ui.posMode, coachMode: ui.coachMode, orderMode: ui.orderMode,
      auction: ui.auctionMode,
    });
    ui.draftOrder = game.order.slice(); // capture (matters for random order)
    initCpuProfiles();
    buildDraftStaticUI();
    ui.staticBuilt = true;
    showScreen("#draft-screen");
    if (online) pushOnlineState();
    renderDraft();
    // Relay online games: surface the invite link IMMEDIATELY, before anyone
    // is asked to pick — you can share first, then start drafting.
    if (online && !ui.live) showShareGate(location.href, null);
  }

  /** Game config that must travel with online links/rooms. */
  function currentConfig() {
    const cfg = {
      clock: ui.clockSeconds,
      cap: ui.capMode,
      capAmt: ui.capChoice,
      eras: ui.allowedEras,
      pos: ui.posMode,
      coach: ui.coachMode,
      order: ui.orderMode,
      auction: ui.auctionMode,
      pace: ui.cpuPace,
      chal: ui.challenge,
      chalSeed: ui.chalSeed,
    };
    // Random order isn't reproducible from the mode alone — carry the actual
    // pick order so every device/replay sees the same sequence.
    if (ui.orderMode === "random" && ui.draftOrder) cfg.seatOrder = ui.draftOrder;
    return cfg;
  }
  function applyConfig(cfg) {
    if (!cfg) return;
    if (cfg.clock != null) ui.clockSeconds = cfg.clock;
    if (cfg.cap != null) ui.capMode = cfg.cap;
    if (cfg.capAmt != null) ui.capChoice = cfg.capAmt;
    if (Array.isArray(cfg.eras) && cfg.eras.length) ui.allowedEras = cfg.eras;
    if (cfg.pos != null) ui.posMode = cfg.pos;
    if (cfg.coach != null) ui.coachMode = cfg.coach;
    if (cfg.order != null) ui.orderMode = cfg.order;
    if (cfg.auction != null) ui.auctionMode = cfg.auction;
    if (cfg.pace != null) ui.cpuPace = cfg.pace;
    if (cfg.chal != null) { ui.challenge = cfg.chal; _dailySet = null; }
    if (cfg.chalSeed != null) { ui.chalSeed = cfg.chalSeed; _dailySet = null; }
    if (Array.isArray(cfg.seatOrder)) ui.draftOrder = cfg.seatOrder;
  }

  // Each CPU gets its own temperament (how greedy vs. exploratory) and a draft
  // "style" so different computer GMs build differently — and so the same human
  // pick never yields the same CPU draft twice.
  let cpuProfiles = {};
  const CPU_STYLES = ["best", "peak", "winning", "defense", "spacing", "playmaking", "twoway", "upside"];

  function initCpuProfiles() {
    cpuProfiles = {};
    game.managers.forEach((m) => {
      if (!m.isCpu) return;
      cpuProfiles[m.id] = {
        temp: 1.4 + Math.random() * 1.2, // 1.4 (greedy) .. 2.6 — mostly takes the best
        style: CPU_STYLES[Math.floor(Math.random() * CPU_STYLES.length)],
      };
    });
  }

  /** A small style lean (±a couple points) — enough to differentiate CPUs,
   *  not enough to make them pass a clearly better player. */
  function cpuStyleBonus(player, style) {
    const r = player.ratings;
    const c = player.career;
    switch (style) {
      case "peak": return (peakOverall(player) - 80) * 0.08;
      case "winning": return (c.winning - 75) * 0.06;
      case "defense": return ((r.perimeterD + r.interiorD) / 2 - 70) * 0.06;
      case "spacing": return (r.shooting - 70) * 0.06;
      case "playmaking": return (r.playmaking - 70) * 0.06;
      case "twoway": return ((r.perimeterD + r.scoring) / 2 - 75) * 0.06;
      case "upside": return (c.aging - 75) * 0.05 + (c.earlyImpact - 60) * 0.025;
      default: return 0; // "best" — pure fit, just sampled
    }
  }

  /** Weighted random choice. */
  function weightedPick(items, weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    let x = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      x -= weights[i];
      if (x <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  // ========================================================================
  //  DRAFT SCREEN
  // ========================================================================
  // Draft-room tabs (Yahoo-style): Players / Board / Teams.
  const DRAFT_TABS = [
    ["players", "🏀 Players"],
    ["board", "📋 Board"],
    ["teams", "👥 Teams"],
  ];
  function setTab(key) {
    const changed = ui.activeTab !== key;
    ui.activeTab = key;
    DRAFT_TABS.forEach(([k]) => $("#tab-" + k).classList.toggle("active", k === key));
    $("#draft-tabs").querySelectorAll(".dt").forEach((b) => b.classList.toggle("active", b._tab === key));
    // Only scroll to top when the visible tab actually changes — never on a
    // re-render, so live auction bidding doesn't keep yanking you upward.
    if (changed && typeof window.scrollTo === "function") window.scrollTo(0, 0);
  }

  function buildDraftStaticUI() {
    // Tab bar
    const nav = $("#draft-tabs");
    nav.innerHTML = "";
    DRAFT_TABS.forEach(([key, label]) => {
      const b = el("button", "dt" + (ui.activeTab === key ? " active" : ""), label);
      b._tab = key;
      b.onclick = () => setTab(key);
      nav.appendChild(b);
    });
    setTab(ui.activeTab);

    // Position filter chips
    const pf = $("#pos-filters");
    pf.innerHTML = "";
    const filters = ["ALL", ...STARTER_SLOTS];
    if (game.coachMode) filters.push("COACH");
    filters.forEach((p) => {
      const chip = el("div", "pf" + (p === ui.posFilter ? " active" : ""), p === "COACH" ? "🧠 COACH" : p);
      chip.addEventListener("click", () => {
        ui.posFilter = p;
        pf.querySelectorAll(".pf").forEach((c) => c.classList.toggle("active", c.textContent === (p === "COACH" ? "🧠 COACH" : p)));
        renderPlayerList();
      });
      pf.appendChild(chip);
    });

    $("#search").value = "";
    let searchTimer = null;
    $("#search").oninput = (e) => {
      const v = e.target.value.toLowerCase();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        ui.search = v;
        renderPlayerList();
      }, 120); // debounce so typing doesn't re-sort/re-render every keystroke
    };
    $("#sort-by").value = ui.sortBy;
    $("#sort-by").onchange = (e) => {
      ui.sortBy = e.target.value;
      renderPlayerList();
    };

    $("#slot-cancel").onclick = closeModal;
    $("#copy-link").onclick = copyShareLink;
  }

  function copyShareLink() {
    const url = location.href;
    const btn = $("#copy-link");
    const done = () => {
      btn.textContent = "✅ Link copied — send it on!";
      setTimeout(() => (btn.textContent = "🔗 Copy link to send"), 2500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, () => prompt("Copy this link:", url));
    } else {
      prompt("Copy this link:", url);
    }
  }

  function renderDraft() {
    stopClock();
    $("#turn-modal").classList.add("hidden"); // re-shown by manageClock if needed
    if (game.isComplete) {
      showResults();
      return;
    }
    // Announce each new pick with a toast — the draft-room "with the 5th pick…"
    // moment. Only fires for exactly-one new pick (not link/room replays).
    const nPicks = game.pickLog.length;
    if (ui.announcedCount != null && nPicks === ui.announcedCount + 1) {
      showPickToast(game.pickLog[nPicks - 1]);
    }
    ui.announcedCount = nPicks;

    // Yahoo-style snap-back: the moment a new pick puts a human (on this device)
    // on the clock, jump to the Players tab so they can draft immediately.
    const cur = game.currentManager();
    if (game.pickLog.length !== ui.lastPickSeen) {
      ui.lastPickSeen = game.pickLog.length;
      const yourTurn = cur && !cur.isCpu && (!ui.live || myTurn());
      if (yourTurn && ui.activeTab !== "players") setTab("players");
    }
    renderStatus();
    renderMyStatus();
    renderAuctionBidbar();
    renderSharePanel();
    renderDraftBoard();
    renderTeamNeeds();
    renderQueueStrip();
    renderPlayerList();
    renderAllRosters();
    renderAuctionPanel();

    // Drive automated picks: local/relay CPUs here; live rooms (CPU + failover)
    // via the resilient driver below.
    scheduleCpuPick();
    scheduleLiveDrivers();
    manageClock();
  }

  // ---- Pick clock (item 1) -----------------------------------------------
  // Whose device "owns" the clock for the current turn (shows it + auto-picks).
  function ownsClock() {
    const m = game.currentManager();
    if (!m) return false;
    if (m.isCpu) {
      if (!ui.online) return false; // local CPUs are instant; no clock
      return !ui.live || ui.isHost; // online: host runs CPU clocks
    }
    return !ui.live || myTurn(); // human: the on-clock seat's device
  }
  function manageClock() {
    if (game.isComplete || ui.paused) return;
    if (game.auction) {
      // Auction: the pick clock becomes a NOMINATION timer for the human whose
      // turn it is to nominate. Bidding is paced by the separate hammer clock.
      if (ui.auction) return;
      const nm = game.currentManager();
      if (!nm || nm.isCpu || !ownsClock()) return;
      if (ui.clockSeconds > 0) startClock();
      return;
    }
    if (!ownsClock()) return;
    const m = game.currentManager();
    // EVERY human turn (local pass-and-play AND online, with or without a
    // clock) is gated behind an explicit "Go": the message tells you it's your
    // turn, and the clock only starts once you acknowledge it — nobody's clock
    // burns while the device changes hands or they're getting to their phone.
    // CPU clocks start immediately.
    if (m && !m.isCpu) {
      const atPick = game.pickLog.length;
      if (ui.turnGatePick === atPick) {
        if (ui.clockSeconds > 0) startClock();
      } else {
        showTurnGate(atPick);
      }
      return;
    }
    if (ui.clockSeconds > 0) startClock();
  }
  /** Animated "…selects Michael Jordan" banner after every pick. */
  function showPickToast(entry) {
    const t = $("#pick-toast");
    if (!t) return;
    const p = entry.player;
    const isCoach = p.isCoach;
    const img = !isCoach && p.photo ? `<img src="${p.photo}" alt="" loading="lazy" />` : `<span class="ptt-emoji">${isCoach ? "🧠" : "🏀"}</span>`;
    const slotTxt = isCoach ? "head coach" : entry.slot;
    const priceTxt = entry.price != null ? ` · sold for $${entry.price}` : "";
    t.innerHTML =
      `${img}<div class="ptt-text">` +
      `<b>${entry.managerName}</b> ${entry.price != null ? "wins" : "selects"} <b>${p.name}</b>` +
      `<span>Pick #${entry.overall} · ${slotTxt}${isCoach ? "" : " · " + careerRating(p) + " ovr"}${priceTxt}</span></div>`;
    t.classList.remove("hidden", "show");
    void (t.offsetWidth || 0); // restart the slide-in animation
    t.classList.add("show");
    SFX.play(entry.price != null ? "sold" : "pick");
    clearTimeout(ui._toastTimer);
    ui._toastTimer = setTimeout(() => t.classList.add("hidden"), 3000);
  }

  function showTurnGate(atPick) {
    const modal = $("#turn-modal");
    const m = game.currentManager();
    const hasClock = ui.clockSeconds > 0;
    $("#turn-modal-title").textContent = `🟢 ${m ? m.name : "You"} — you're on the clock!`;
    $("#turn-modal-sub").innerHTML = hasClock
      ? `Round ${game.currentRound()} · Pick #${game.overallPickNumber()}. Your ` +
        `${formatClock(ui.clockSeconds)} pick clock starts when you hit <b>Go</b> — ` +
        `it won't run until you're ready.`
      : `Round ${game.currentRound()} · Pick #${game.overallPickNumber()}. ` +
        `No pick clock — take your time and build something great.`;
    $("#turn-go").textContent = hasClock ? "Go — start my clock ▶" : "Go — I'm ready ▶";
    $("#turn-go").onclick = () => {
      ui.turnGatePick = atPick;
      modal.classList.add("hidden");
      if (hasClock) startClock();
    };
    modal.classList.remove("hidden");
    SFX.play("yourturn");
  }
  const formatClock = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  function startClock() {
    const gen = ui.gameGen;
    ui.clockRemaining = ui.clockSeconds;
    $("#pick-clock").classList.remove("hidden");
    updateClockDisplay();
    ui.clockTimer = setInterval(() => {
      if (gen !== ui.gameGen) return clearInterval(ui.clockTimer);
      if (ui.paused) return; // frozen while paused; the interval keeps waiting
      ui.clockRemaining -= 1;
      updateClockDisplay();
      if (ui.clockRemaining > 0 && ui.clockRemaining <= 10) SFX.play("tick");
      if (ui.clockRemaining <= 0) {
        clearInterval(ui.clockTimer);
        SFX.play("buzzer");
        const cur = game.currentManager();
        // CPU turns are handled elsewhere; only auto-act for a human who let the
        // clock expire — auto-NOMINATE in an auction, otherwise auto-pick.
        if (cur && !cur.isCpu) {
          if (game.auction && !ui.auction) autoNominate(cur);
          else autoPick(cur);
        }
      }
    }, 1000);
  }
  function stopClock() {
    if (ui.clockTimer) clearInterval(ui.clockTimer);
    ui.clockTimer = null;
    $("#pick-clock").classList.add("hidden");
  }
  function updateClockDisplay() {
    const s = Math.max(0, ui.clockRemaining);
    $("#clock-time").textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    $("#pick-clock").classList.toggle("warn", s <= 10);
  }
  /** Best available pick for a manager (used by clock auto-pick and failover). */
  function bestAvailablePick(manager) {
    // Queue first: if THIS device's manager starred players, take the first
    // queued player who's still available and legal (never applies when a
    // backup device is covering someone else's turn).
    const queueApplies = !manager.isCpu && (!ui.live || manager.id === ui.mySeat);
    if (queueApplies && ui.queue.length) {
      for (const id of ui.queue) {
        const p = findDraftable(id);
        if (p && !p.isCoach && isDraftable(manager, p) && game.legalSlotsFor(manager, p).length) {
          const ss = game.legalSlotsFor(manager, p).filter((s) => s !== "BENCH");
          if (ss.length) return { player: p, slot: ss.includes(p.pos) ? p.pos : ss[0] };
        }
      }
    }
    const avail = PLAYER_POOL.filter((p) => isDraftable(manager, p));
    if (avail.length) {
      avail.sort(
        (a, b) =>
          careerRating(b) + 0.15 * bestFit(manager, b) - (careerRating(a) + 0.15 * bestFit(manager, a))
      );
      const best = avail[0];
      const ss = game.legalSlotsFor(manager, best).filter((s) => s !== "BENCH");
      return { player: best, slot: ss.includes(best.pos) ? best.pos : ss[0] };
    }
    // No legal player (e.g. the five are set) — hire the best-fitting coach.
    if (game.needsCoach(manager)) return bestAvailableCoach(manager);
    return null;
  }
  /** Best-fitting available coach for a manager. */
  function bestAvailableCoach(manager) {
    const coaches = (typeof COACH_POOL !== "undefined" ? COACH_POOL : []).filter((c) => isDraftable(manager, c));
    if (!coaches.length) return null;
    coaches.sort((a, b) => coachFit(manager, b) - coachFit(manager, a));
    return { player: coaches[0], slot: "COACH" };
  }
  /** Time expired — auto-draft the best available pick for this manager. */
  function autoPick(manager) {
    const c = bestAvailablePick(manager);
    if (!c) return;
    closeModal();
    commitPick(c.player, c.slot);
  }
  /** Auction nomination clock expired — auto-nominate this manager's best value. */
  function autoNominate(manager) {
    const c = bestAvailablePick(manager);
    if (c) openAuction(c.player);
  }

  // ---- Pause / resume -----------------------------------------------------
  function togglePause() { setPaused(!ui.paused); }
  function setPaused(on) {
    ui.paused = on;
    $("#pause-btn").textContent = on ? "▶" : "⏸";
    $("#pause-banner").classList.toggle("hidden", !on);
    if (on) {
      stopClock();
      if (ui.auction && ui.auction.timer) clearInterval(ui.auction.timer);
      if (ui._auTimer) clearInterval(ui._auTimer);
    } else if (game && !game.isComplete) {
      // Re-arm clocks + CPU drivers for whatever's on the block.
      if (ui.auction && !ui.auction.live) armAuctionClock();
      renderDraft();
    }
    if (ui.live && ui.roomId && FBSync.setPaused) FBSync.setPaused(ui.roomId, on);
  }

  // ========================================================================
  //  AUCTION DRAFT (local): nominate, bid in $1 steps or jump, hammer falls
  //  after a few quiet seconds. Winner pays the hammer price against the cap.
  // ========================================================================
  // Seconds of silence before SOLD — Relaxed pace gives more breathing room.
  const auctionGrace = () => (ui.cpuPace === "slow" ? 12 : 8);
  // Delay before a CPU decides to counter-bid (ms). Relaxed feels more human.
  const cpuBidDelay = () =>
    ui.cpuPace === "slow" ? 1500 + Math.random() * 1900 : 500 + Math.random() * 1000;

  const capLeft = (m) => capAmount() - managerSpent(m);
  // Max legal bid: must keep $1 for every OTHER still-unfilled required slot.
  const maxBid = (m) => capLeft(m) - (game.unfilledRequiredSlots(m).length - 1);
  const canBid = (m, p) =>
    !game.rosterComplete(m) && game.legalSlotsFor(m, p).length > 0 && maxBid(m) >= 1;
  const eligibleBidders = (p) => game.managers.filter((m) => canBid(m, p));
  /** The team "you" are for the prominent budget/bid panel: your live seat, the
   *  sole human in a local game, else the manager currently nominating. */
  const auctionMe = () => {
    if (ui.live && ui.mySeat != null) return game.managers[ui.mySeat];
    const humans = game.managers.filter((m) => !m.isCpu);
    if (humans.length === 1) return humans[0];
    const cur = game.currentManager();
    return cur && !cur.isCpu ? cur : humans[0] || game.managers[0];
  };

  /** The team whose budget + needs are pinned in the header: your live seat, else
   *  (auction) your team, else the manager currently on the clock. */
  function focusManager() {
    if (ui.live && ui.mySeat != null) return game.managers[ui.mySeat];
    if (game.auction) return auctionMe();
    return game.currentManager() || game.managers[0];
  }

  /** Always-visible "your team" strip: open positions of need + budget/spent. */
  function renderMyStatus() {
    const box = $("#my-status");
    if (!game || game.isComplete) { box.classList.add("hidden"); return; }
    const m = focusManager();
    if (!m) { box.classList.add("hidden"); return; }
    // Positions of need (open starter slots), plus the coach slot if owed.
    const openSet = new Set(game.unfilledStarterSlots(m));
    const slotPills = STARTER_SLOTS.map((s) => {
      const p = m.starters[s];
      return p
        ? `<span class="ms-slot filled" title="${p.name}">${s}</span>`
        : `<span class="ms-slot open">${s}</span>`;
    }).join("");
    const coachPill = ui.coachMode
      ? (m.coach ? `<span class="ms-slot filled" title="${m.coach.name}">🧠</span>`
                 : `<span class="ms-slot open">🧠</span>`)
      : "";
    let money = "";
    if (ui.capMode) {
      const CAP = capAmount();
      const spent = managerSpent(m);
      const left = CAP - spent;
      money =
        `<span class="ms-money"><span class="ms-left${left < 0 ? " over" : ""}">$${left}</span>` +
        `<small>left of $${CAP} · spent $${spent}</small></span>`;
    }
    box.innerHTML =
      `<span class="ms-team">${m.id === (ui.mySeat) || (!ui.live && !m.isCpu) ? "You" : m.name}</span>` +
      `<span class="ms-slots">${slotPills}${coachPill}</span>${money}`;
    box.classList.remove("hidden");
  }

  /** Pinned live-auction bid controls in the sticky header (never scroll to bid). */
  function renderAuctionBidbar() {
    const bar = $("#auction-bidbar");
    if (!game || !game.auction || !ui.auction) { bar.classList.add("hidden"); bar.innerHTML = ""; return; }
    const a = ui.auction;
    const p = findDraftable(a.pid);
    const leader = game.managers[a.leaderId];
    const me = auctionMe();
    bar.innerHTML = "";

    const top = el("div", "abb-top");
    top.innerHTML =
      `<span class="abb-player">${p.isCoach ? "🧠 " : ""}${p.name}</span>` +
      `<span class="abb-bid">$${a.bid}<small>${leader.isCpu ? "🤖 " : ""}${leader.name}</small></span>` +
      `<span class="abb-clock"></span>`;
    bar.appendChild(top);

    const controls = el("div", "abb-controls");
    const meLeading = me && me.id === a.leaderId;
    const meMax = me ? Math.max(0, maxBid(me)) : 0;
    const meCanBid = me && canBid(me, p) && !meLeading && meMax >= a.bid + 1;
    if (meLeading) {
      controls.appendChild(el("span", "abb-note", "👑 You hold the high bid"));
    } else if (meCanBid) {
      [1, 5, 10].forEach((inc) => {
        const target = a.bid + inc;
        if (inc !== 1 && target > meMax) return;
        const b = el("button", "btn primary abb-btn" + (inc === 1 ? " lead" : ""), `+$${inc}`);
        b.onclick = () => placeBid(me.id, Math.min(target, meMax));
        controls.appendChild(b);
      });
      const maxBtn = el("button", "btn abb-btn", `Max $${meMax}`);
      maxBtn.onclick = () => placeBid(me.id, meMax);
      controls.appendChild(maxBtn);
      const inp = el("input", "abb-amt");
      inp.type = "text";
      inp.placeholder = "$";
      controls.appendChild(inp);
      const bidBtn = el("button", "btn abb-btn", "Bid");
      bidBtn.onclick = () => { const v = parseInt(inp.value, 10); if (v) placeBid(me.id, v); };
      controls.appendChild(bidBtn);
    } else {
      controls.appendChild(el("span", "abb-note muted", me && meMax < a.bid + 1 ? "💰 Maxed out on this player" : "Watching…"));
    }
    bar.appendChild(controls);
    bar.classList.remove("hidden");
    updateAuctionClock();
  }

  /** What a CPU manager privately thinks this player is worth (per auction). */
  function cpuValuation(m, p) {
    const base = proposedValue(p);
    const fit = Math.min(1, Math.max(0, (bestFit(m, p) - 76) / 26));
    const scarcity = game.unfilledRequiredSlots(m).length <= 2 ? 1.12 : 1.0;
    let v = base * (0.82 + 0.3 * fit) * scarcity;
    v *= 0.94 + 0.14 * Math.min(1, capLeft(m) / capAmount()); // rich teams stretch
    v *= 0.92 + Math.random() * 0.18; // personality/noise
    return Math.max(1, Math.min(Math.round(v), maxBid(m)));
  }

  function openAuction(player) {
    if (ui.auction) return;
    const nom = game.currentManager();
    const bidders = eligibleBidders(player);
    if (!bidders.length) return;
    const opener = nom && canBid(nom, player) ? nom : bidders[0];
    if (ui.live) {
      // The room record is the single source of truth; everyone (including us)
      // picks the lot up from the room echo.
      FBSync.setAuction(ui.roomId, { pid: player.id, bid: 1, leaderId: opener.id, ts: Date.now() });
      return;
    }
    ui.auction = { pid: player.id, bid: 1, leaderId: opener.id, gen: ui.gameGen, vals: {}, deadline: auctionGrace(), timer: null };
    armAuctionClock();
    if (ui.auction) scheduleAuctionCpus();
    if (ui.auction) {
      // No scroll-to-top: the pinned bid bar in the header keeps the controls
      // in view, so you can bid without losing your place in the player list.
      renderAuctionBidbar();
      renderAuctionPanel();
      renderPlayerList();
      renderStatus();
    }
  }

  function armAuctionClock() {
    const a = ui.auction;
    if (!a) return;
    a.deadline = auctionGrace();
    if (a.timer) clearInterval(a.timer);
    // Nobody else CAN outbid → hammer falls immediately.
    if (autoSellIfUncontested()) return;
    a.timer = setInterval(() => {
      if (ui.auction !== a || a.gen !== ui.gameGen) return clearInterval(a.timer);
      if (ui.paused) return;
      a.deadline -= 1;
      updateAuctionClock();
      if (a.deadline <= 0) {
        clearInterval(a.timer);
        sellCurrent();
      }
    }, 1000);
    updateAuctionClock();
  }

  /** True (and sells) when no one except the leader can even bid. */
  function autoSellIfUncontested() {
    const a = ui.auction;
    if (!a) return false;
    const p = findDraftable(a.pid);
    const rivals = eligibleBidders(p).filter((m) => m.id !== a.leaderId && maxBid(m) >= a.bid + 1);
    const humanRival = rivals.some((m) => !m.isCpu);
    const cpuRival = rivals.some(
      (m) => m.isCpu && (a.vals[m.id] != null ? a.vals[m.id] : (a.vals[m.id] = cpuValuation(m, p))) >= a.bid + 1
    );
    if (!humanRival && !cpuRival) {
      sellCurrent();
      return true;
    }
    return false;
  }

  /** CPUs consider outbidding after a short, human-feeling pause. */
  function scheduleAuctionCpus() {
    const a = ui.auction;
    if (!a || ui.paused) return;
    const p = findDraftable(a.pid);
    game.managers.forEach((m) => {
      if (!m.isCpu || m.id === a.leaderId || !canBid(m, p)) return;
      const val = a.vals[m.id] != null ? a.vals[m.id] : (a.vals[m.id] = cpuValuation(m, p));
      if (val < a.bid + 1) return;
      setTimeout(() => {
        if (ui.auction !== a || a.gen !== ui.gameGen || ui.paused) return;
        if (a.leaderId === m.id) return;
        const v = a.vals[m.id];
        if (v < a.bid + 1 || maxBid(m) < a.bid + 1) return;
        // Sometimes jump a couple bucks to shake off snipers.
        placeBid(m.id, Math.min(v, a.bid + 1 + Math.floor(Math.random() * 2)));
      }, cpuBidDelay());
    });
  }

  function placeBid(mgrId, amount) {
    const a = ui.auction;
    if (!a) return;
    const m = game.managers[mgrId];
    const p = findDraftable(a.pid);
    amount = Math.floor(amount);
    if (!m || !p || m.id === a.leaderId) return;
    if (!(amount > a.bid) || !canBid(m, p) || amount > maxBid(m)) return;
    if (a.live) {
      FBSync.bidAuction(ui.roomId, a.pid, amount, mgrId); // echo updates everyone
      return;
    }
    a.bid = amount;
    a.leaderId = m.id;
    SFX.play("bid");
    armAuctionClock();
    if (ui.auction) {
      scheduleAuctionCpus();
      renderAuctionBidbar();
      renderAuctionPanel();
    }
  }

  /** Hammer falls: the leader pays the bid and the player joins their roster. */
  function sellCurrent() {
    const a = ui.auction;
    if (!a) return;
    if (a.timer) clearInterval(a.timer);
    const price = a.bid, pid = a.pid, winnerId = a.leaderId;
    ui.auction = null;
    const p = findDraftable(pid);
    const winner = game.managers[winnerId];
    const finalize = (slot) => {
      game.draft(p, slot, { forId: winner.id, price });
      renderDraft();
    };
    const slots = game.legalSlotsFor(winner, p).filter((s) => s !== "BENCH");
    // Human winner on THIS device + locked positions + a real choice → let them
    // pick which slot the player fills. (Flexible auto-arranges; CPUs auto-slot.)
    const humanHere = !winner.isCpu && (!ui.live || winner.id === ui.mySeat);
    if (!p.isCoach && game.posMode === "locked" && humanHere && slots.length > 1) {
      openSlotChoice(p, `${winner.name} won ${p.name} for $${price} — choose a starting slot.`, slots, finalize);
      return;
    }
    finalize(p.isCoach ? "COACH" : slots.includes(p.pos) ? p.pos : slots[0]);
  }

  /** Generic slot-choice modal that runs a callback with the chosen slot. */
  function openSlotChoice(player, sub, slots, done) {
    $("#slot-modal-title").textContent = `Where will ${player.name} play?`;
    $("#slot-modal-sub").textContent = sub;
    const wrap = $("#slot-options");
    wrap.innerHTML = "";
    slots.forEach((s) => {
      const o = el("div", "so", s === "BENCH" ? "Bench" : s);
      o.onclick = () => { $("#slot-modal").classList.add("hidden"); done(s); };
      wrap.appendChild(o);
    });
    $("#slot-modal").classList.remove("hidden");
  }

  /** The live-auction block: nominated player's card + bid state + bidder rows. */
  function renderAuctionPanel() {
    const panel = $("#auction-panel");
    if (!game || !game.auction || !ui.auction) {
      panel.classList.add("hidden");
      panel.innerHTML = "";
      return;
    }
    const a = ui.auction;
    const p = findDraftable(a.pid);
    const leader = game.managers[a.leaderId];
    panel.classList.remove("hidden");
    panel.innerHTML = "";

    const head = el("div", "au-head");
    head.appendChild(playerPhoto(p, p.isCoach ? p.overall : careerRating(p)));
    const info = el("div", "au-info");
    const pct = Math.round((proposedValue(p) / capAmount()) * 100);
    info.innerHTML = p.isCoach
      ? `<div class="au-name">🧠 ${p.name}</div>
         <div class="au-tags">
           <span class="tag pos">${p.style}</span>
           <span class="tag">Coach ${p.overall}</span>
           <span class="tag">Off ${p.traits.off}</span><span class="tag">Def ${p.traits.def}</span>
         </div>
         <div class="au-value">Proposed value <b>$${proposedValue(p)}</b> · ${pct}% of the $${capAmount()} cap</div>`
      : `<div class="au-name">${tierBadge(p)} ${p.name} ${injuryDot(p.injuryRisk)}</div>
         <div class="au-tags">
           <span class="tag pos">${p.eligible.join("/")}</span>
           <span class="tag">Peak ${peakOverall(p)}</span>
           <span class="tag">Clutch ${p.ext.clutch}</span>
           <span class="tag">${SCORING.usageTier(p)}</span>
           <span class="tag">${p.archetype}</span>
         </div>
         <div class="au-value">Proposed value <b>$${proposedValue(p)}</b> · ${pct}% of the $${capAmount()} cap</div>`;
    head.appendChild(info);
    const bidbox = el(
      "div",
      "au-bid",
      `<span class="au-bid-label">Current bid</span><span class="au-bid-amt">$${a.bid}</span>` +
        `<span class="au-leader">${leader.isCpu ? "🤖 " : ""}${leader.name}</span>` +
        `<span class="au-clock"></span>`
    );
    head.appendChild(bidbox);
    panel.appendChild(head);

    // ---- YOUR prominent budget + bid controls -----------------------------
    const me = auctionMe();
    if (me) {
      const meLeading = me.id === a.leaderId;
      const meMax = Math.max(0, maxBid(me));
      const meLeft = capLeft(me);
      const meCanBid = canBid(me, p) && !meLeading && meMax >= a.bid + 1;
      const you = el("div", "au-you" + (meLeading ? " leading" : ""));
      const budget = el("div", "au-you-budget");
      budget.innerHTML =
        `<span class="ayb-team">${me.name}${meLeading ? ' <span class="au-lead-tag">HIGH BID</span>' : ""}</span>` +
        `<span class="ayb-nums"><span class="ayb-left">$${meLeft}</span><small>left of $${capAmount()}</small>` +
        `<span class="ayb-max">max bid $${meMax}</span></span>`;
      you.appendChild(budget);

      const bidArea = el("div", "au-you-bid");
      if (meLeading) {
        bidArea.appendChild(el("div", "au-you-lead", "👑 You hold the high bid — sit tight or wait it out."));
      } else if (meCanBid) {
        const quick = [1, 5, 10];
        quick.forEach((inc) => {
          const target = a.bid + inc;
          if (inc !== 1 && target > meMax) return;
          const b = el("button", "btn primary au-quickbid" + (inc === 1 ? " lead" : ""), `+$${inc} → $${target}`);
          b.onclick = () => placeBid(me.id, Math.min(target, meMax));
          bidArea.appendChild(b);
        });
        const maxBtn = el("button", "btn au-quickbid", `Max $${meMax}`);
        maxBtn.onclick = () => placeBid(me.id, meMax);
        bidArea.appendChild(maxBtn);
        const inp = el("input", "au-amt big");
        inp.type = "text";
        inp.placeholder = "$ custom";
        bidArea.appendChild(inp);
        const bidBtn = el("button", "btn au-quickbid", "Bid");
        bidBtn.onclick = () => {
          const v = parseInt(inp.value, 10);
          if (v) placeBid(me.id, v);
        };
        bidArea.appendChild(bidBtn);
      } else {
        bidArea.appendChild(el("div", "au-you-lead muted", meMax < a.bid + 1 ? "💰 You're maxed out on this player." : "No open slot for this player."));
      }
      you.appendChild(bidArea);
      panel.appendChild(you);
    }

    // ---- Other bidders (compact status; inline controls for OTHER humans) --
    const rows = el("div", "au-rows");
    game.managers.forEach((m) => {
      if (game.rosterComplete(m)) return;
      if (me && m.id === me.id) return; // "you" are shown prominently above
      const leading = m.id === a.leaderId;
      const able =
        canBid(m, p) && !leading && maxBid(m) >= a.bid + 1 && !ui.live && !m.isCpu;
      const row = el("div", "au-row" + (leading ? " leading" : ""));
      const nameCol = el(
        "div",
        "au-mname",
        `${m.isCpu ? "🤖 " : ""}${m.name}${leading ? ' <span class="au-lead-tag">HIGH BID</span>' : ""}` +
          `<span class="au-mbudget">$${capLeft(m)} left · max bid $${Math.max(0, maxBid(m))}</span>`
      );
      row.appendChild(nameCol);
      const act = el("div", "au-actions");
      if (able) {
        const plus = el("button", "btn primary mini", `+$1 → $${a.bid + 1}`);
        plus.onclick = () => placeBid(m.id, a.bid + 1);
        act.appendChild(plus);
        const inp = el("input", "au-amt");
        inp.type = "text";
        inp.placeholder = "$";
        act.appendChild(inp);
        const bidBtn = el("button", "btn mini", "Bid");
        bidBtn.onclick = () => {
          const v = parseInt(inp.value, 10);
          if (v) placeBid(m.id, v);
        };
        act.appendChild(bidBtn);
      } else if (leading) {
        act.appendChild(el("span", "slot-sub", "👑 leading"));
      } else if (m.isCpu) {
        act.appendChild(el("span", "slot-sub", "🤖 weighing a bid…"));
      } else {
        act.appendChild(el("span", "slot-sub", maxBid(m) < a.bid + 1 ? "💰 maxed out" : "no open slot"));
      }
      row.appendChild(act);
      rows.appendChild(row);
    });
    if (rows.children.length) {
      panel.appendChild(el("div", "au-rows-label", "Other bidders"));
      panel.appendChild(rows);
    }
    updateAuctionClock();
  }

  function updateAuctionClock() {
    const a = ui.auction;
    if (!a) return;
    const s = Math.max(0, (a.live ? auctionSecondsLeft() : a.deadline) | 0);
    const txt = s > 4 ? `⏳ ${s}s` : s > 2 ? "going once…" : s > 0 ? "going twice…" : "SOLD!";
    [$("#auction-panel").querySelector(".au-clock"), $("#auction-bidbar").querySelector(".abb-clock")].forEach((c) => {
      if (!c) return;
      c.textContent = txt;
      c.classList.toggle("warn", s <= 4);
    });
  }

  // ---- Live (Firebase) auctions: room state drives every device -----------
  function auctionSecondsLeft() {
    const a = ui.auction;
    return a ? Math.ceil(auctionGrace() - (Date.now() - a.ts) / 1000) : 0;
  }
  /** Adopt the room's auction state (or clear it). Called on every room echo. */
  function syncLiveAuction(remote) {
    if (!ui.live || !game.auction) return;
    if (!remote || !game.isAvailable(remote.pid)) {
      if (ui.auction && ui.auction.live) {
        ui.auction = null;
        if (ui._auTimer) clearInterval(ui._auTimer);
      }
      // A lot left behind for an already-sold player: host tidies up.
      if (remote && !game.isAvailable(remote.pid) && ui.isHost) FBSync.clearAuction(ui.roomId);
      return;
    }
    const prev = ui.auction && ui.auction.pid === remote.pid ? ui.auction : null;
    if (prev && remote.bid > prev.bid) SFX.play("bid");
    ui.auction = {
      pid: remote.pid,
      bid: remote.bid,
      leaderId: remote.leaderId,
      ts: remote.ts || Date.now(),
      deadline: auctionGrace(),
      gen: ui.gameGen,
      live: true,
      vals: prev ? prev.vals : {},
    };
  }
  /** Countdown + hammer. Host is the timekeeper; seated devices back it up. */
  function startLiveAuctionTicker() {
    if (ui._auTimer) clearInterval(ui._auTimer);
    ui._auTimer = setInterval(() => {
      const a = ui.auction;
      if (!a || !a.live) return clearInterval(ui._auTimer);
      if (ui.paused) return;
      updateAuctionClock();
      const graceExtra = ui.isHost ? 0 : 6 + (ui.mySeat || 0) * 2;
      if (auctionSecondsLeft() <= -graceExtra && (ui.isHost || ui.mySeat != null)) {
        clearInterval(ui._auTimer);
        liveSell();
      }
    }, 500);
  }
  function liveSell() {
    const a = ui.auction;
    if (!a) return;
    ui.auction = null;
    const p = findDraftable(a.pid);
    const winner = game.managers[a.leaderId];
    if (!p || !winner) return;
    const slots = game.legalSlotsFor(winner, p).filter((s) => s !== "BENCH");
    const slot = p.isCoach ? "COACH" : slots.includes(p.pos) ? p.pos : slots[0];
    // The transaction guarantees exactly one device commits the sale.
    FBSync.appendPickIf(ui.roomId, game.pickLog.length, [a.pid, slot, a.bid, a.leaderId]).then(
      (committed) => { if (committed) FBSync.clearAuction(ui.roomId); }
    );
  }
  /** Host schedules CPU bids against the live lot (writes via transaction). */
  function hostDriveAuctionCpus() {
    const a = ui.auction;
    if (!a || !a.live || !ui.isHost || ui.paused) return;
    const p = findDraftable(a.pid);
    game.managers.forEach((m) => {
      if (!m.isCpu || m.id === a.leaderId || !canBid(m, p)) return;
      const val = a.vals[m.id] != null ? a.vals[m.id] : (a.vals[m.id] = cpuValuation(m, p));
      if (val < a.bid + 1) return;
      setTimeout(() => {
        const cur = ui.auction;
        if (!cur || !cur.live || cur.pid !== a.pid || cur.leaderId === m.id) return;
        const v = cur.vals[m.id] != null ? cur.vals[m.id] : val;
        if (v < cur.bid + 1 || maxBid(m) < cur.bid + 1) return;
        FBSync.bidAuction(ui.roomId, cur.pid, Math.min(v, cur.bid + 1 + Math.floor(Math.random() * 2)), m.id);
      }, cpuBidDelay());
    });
  }

  // ---- Live-room emoji reactions ------------------------------------------
  const REACTIONS = ["🔥", "😂", "🗑️", "😱", "💪", "🥶"];
  function renderReactBar() {
    const bar = $("#react-bar");
    if (!ui.live || ui.mySeat == null) {
      bar.classList.add("hidden");
      return;
    }
    if (!bar.children.length) {
      REACTIONS.forEach((emo) => {
        const b = el("button", "react-btn", emo);
        b.onclick = () => FBSync.react(ui.roomId, ui.mySeat, emo);
        bar.appendChild(b);
      });
    }
    bar.classList.remove("hidden");
  }
  function handleReactions(data) {
    const rx = data && data.reactions;
    if (!rx) return;
    const keys = Object.keys(rx).sort();
    if (!keys.length) return;
    if (ui.lastReactKey == null) {
      ui.lastReactKey = keys[keys.length - 1]; // don't replay history on join
      return;
    }
    keys.forEach((k) => {
      if (k <= ui.lastReactKey) return;
      ui.lastReactKey = k;
      const v = rx[k];
      const seat = v[0];
      floatEmoji(v[1], game.managers[seat] ? game.managers[seat].name : "");
    });
  }
  function floatEmoji(emoji, who) {
    const body = document.body;
    if (!body || typeof body.appendChild !== "function") return;
    const e = el("div", "emoji-float", `${emoji}<span>${who}</span>`);
    e.style.left = 12 + Math.random() * 72 + "%";
    body.appendChild(e);
    setTimeout(() => e.remove(), 2600);
  }

  /** The online banner: live room status (your turn / waiting) or relay link. */
  function renderSharePanel() {
    const panel = $("#share-panel");
    if (!ui.online) {
      panel.classList.add("hidden");
      return;
    }
    panel.classList.remove("hidden");
    const m = game.currentManager();
    const turnEl = panel.querySelector(".share-turn");
    const instrEl = panel.querySelector(".share-instr");
    const copyBtn = $("#copy-link");

    if (ui.live) {
      // Real-time room: share the link once, then everyone drafts on their turn.
      copyBtn.textContent = "🔗 Copy room link";
      const mine = myTurn();
      const youAre = ui.mySeat != null ? ` — you're ${game.managers[ui.mySeat].name}` : "";
      turnEl.innerHTML = mine
        ? `🟢 <b>Your turn</b> — make your pick below${youAre}`
        : `⏳ Waiting for <b>${m.name}</b> to pick${youAre}`;
      instrEl.textContent =
        "Live room — picks sync in real time. Share this link once so each manager can join on their own device.";
      renderReactBar();
    } else {
      $("#react-bar").classList.add("hidden");
      copyBtn.textContent = "🔗 Copy link to send";
      turnEl.innerHTML = `🔗 It's <b>${m.name}</b>'s turn`;
      instrEl.textContent =
        `${m.name}: make your pick below, then copy this link and send it to the next manager so they can take their turn.`;
    }
  }

  // ---- CPU autodraft -----------------------------------------------------
  const CPU_DELAY_MS = 500; // local: snappy
  // Local CPU pick delay, honoring the chosen pace.
  const cpuPickDelay = () => (ui.cpuPace === "slow" ? 1400 + Math.random() * 900 : CPU_DELAY_MS);

  function scheduleCpuPick() {
    if (ui.live || game.isComplete || ui.paused) return; // live handled by scheduleLiveDrivers
    const m = game.currentManager();
    if (!m || !m.isCpu) return;
    closeModal(); // a CPU never uses the manual slot picker
    const gen = ui.gameGen;
    const atPick = game.pickLog.length;

    // Auction: the CPU's turn is a NOMINATION — it opens the bidding.
    if (game.auction) {
      if (ui.auction) return; // a lot is already on the block
      setTimeout(() => {
        if (gen !== ui.gameGen || !game || game.isComplete || ui.auction) return;
        if (game.pickLog.length !== atPick) return;
        const cur = game.currentManager();
        if (!cur || !cur.isCpu) return;
        const choice = cpuChoose(cur);
        if (choice) openAuction(choice.player);
      }, ui.cpuPace === "slow" ? 1300 + Math.random() * 1000 : 700 + Math.random() * 800);
      return;
    }

    const delay = ui.online ? 1600 + Math.random() * 1800 : cpuPickDelay();
    setTimeout(() => {
      if (gen !== ui.gameGen || !game || game.isComplete) return;
      if (game.pickLog.length !== atPick) return;
      const cur = game.currentManager();
      if (!cur || !cur.isCpu) return;
      const choice = cpuChoose(cur);
      if (choice) commitPick(choice.player, choice.slot);
    }, delay);
  }

  /**
   * Live-room driving with FAILOVER, so the draft survives anyone tabbing away
   * (background tabs get throttled/frozen by the browser).
   *   • CPU turn: the host drives it fast; every present, seated player is a
   *     staggered backup that covers if the host's device is asleep.
   *   • Human turn: that player's own device clock auto-picks at expiry; if THAT
   *     device is frozen too, present backups cover ~6s after the clock would end.
   * An atomic transaction guarantees only one pick ever commits (no doubles).
   */
  function scheduleLiveDrivers() {
    if (!ui.live || !ui.roomReady || game.isComplete || ui.paused) return;
    const m = game.currentManager();
    if (!m) return;
    const atPick = game.pickLog.length;
    const myRoom = ui.roomId;
    const seated = ui.mySeat != null;

    // Live AUCTION: turns are nominations. The host opens the bidding for CPU
    // nominators; human nominations come from their own device (no expiry).
    if (game.auction) {
      if (ui.auction || !m.isCpu || !ui.isHost) return;
      setTimeout(() => {
        if (ui.roomId !== myRoom || !game || game.isComplete || ui.auction) return;
        if (game.pickLog.length !== atPick) return;
        const cur = game.currentManager();
        if (!cur || !cur.isCpu) return;
        const choice = cpuChoose(cur);
        if (choice) openAuction(choice.player);
      }, 1500 + Math.random() * 1500);
      return;
    }

    let delay = null;
    if (m.isCpu) {
      if (ui.isHost) delay = 1600 + Math.random() * 1800; // primary
      else if (seated) delay = 9000 + (ui.mySeat || 0) * 1500 + Math.random() * 1200; // backup
    } else if (ui.clockSeconds > 0 && !myTurn() && (ui.isHost || seated)) {
      // Backup only — the on-clock human's own device handles the normal expiry.
      // Generous grace: their clock doesn't start until they hit "Go", so other
      // devices wait clock + 2 minutes before covering a seemingly-gone player.
      delay = (ui.clockSeconds + 120) * 1000 + (ui.mySeat || 0) * 1500 + Math.random() * 1200;
    }
    if (delay == null) return;

    setTimeout(() => {
      if (ui.roomId !== myRoom || !game || game.isComplete) return;
      if (game.pickLog.length !== atPick) return; // someone already picked
      const cur = game.currentManager();
      if (!cur) return;
      const choice = cur.isCpu ? cpuChoose(cur) : bestAvailablePick(cur);
      if (!choice) return;
      FBSync.appendPickIf(myRoom, atPick, [choice.player.id, choice.slot]);
    }, delay);
  }

  /**
   * CPU draft strategy: take the best-fitting available player for the roster's
   * current needs, then slot them at their best legal position (preferring their
   * natural position, bench only as a last resort).
   */
  function cpuChoose(manager) {
    const avail = PLAYER_POOL.filter((p) => isDraftable(manager, p));
    // No draftable player (the five are set) — or, late in the draft, time to grab
    // the coach. CPUs hire their coach once players no longer fit a slot.
    if (avail.length === 0) {
      if (game.needsCoach(manager)) return cpuChooseCoach(manager);
      return null;
    }

    const prof = cpuProfiles[manager.id] || { temp: 3.5, style: "best" };

    // Grade leads with talent (career rating) so the best player isn't lost to
    // the fit cap on an open roster; fit nudges toward filling needs, and the
    // style lean adds a little personality.
    const graded = avail
      .map((p) => ({
        p,
        g: careerRating(p) + 0.15 * (bestFit(manager, p) - 80) + cpuStyleBonus(p, prof.style),
      }))
      .sort((a, b) => b.g - a.g);

    // Consider only the genuinely close options (within a tight margin of the
    // best), then sample among them weighted steeply toward the best — so the
    // CPU reliably takes a top player but isn't perfectly predictable.
    const top = graded[0].g;
    const MARGIN = 3;
    const pool = graded.filter((x) => x.g >= top - MARGIN).slice(0, 4);
    const weights = pool.map((x) => Math.exp((x.g - top) / prof.temp));
    const best = weightedPick(pool.map((x) => x.p), weights);

    const legal = game.legalSlotsFor(manager, best);
    const starterSlots = legal.filter((s) => s !== "BENCH");
    let slot;
    if (starterSlots.length === 0) {
      slot = "BENCH";
    } else if (starterSlots.includes(best.pos)) {
      slot = best.pos; // natural position when available
    } else {
      // Otherwise the eligible starter slot that grades out best.
      slot = starterSlots.reduce(
        (a, b) => (pickFitGrade(manager, best, b) >= pickFitGrade(manager, best, a) ? b : a),
        starterSlots[0]
      );
    }
    return { player: best, slot };
  }

  /** CPU coach pick: sample among the best-fitting available coaches. */
  function cpuChooseCoach(manager) {
    const coaches = (typeof COACH_POOL !== "undefined" ? COACH_POOL : []).filter((c) => isDraftable(manager, c));
    if (!coaches.length) return null;
    const prof = cpuProfiles[manager.id] || { temp: 3.5 };
    const graded = coaches.map((c) => ({ p: c, g: coachFit(manager, c) })).sort((a, b) => b.g - a.g);
    const top = graded[0].g;
    const pool = graded.filter((x) => x.g >= top - 4).slice(0, 4);
    const weights = pool.map((x) => Math.exp((x.g - top) / prof.temp));
    return { player: weightedPick(pool.map((x) => x.p), weights), slot: "COACH" };
  }

  function renderStatus() {
    const m = game.currentManager();
    $("#sticky-onclock").textContent = (m.isCpu ? "🤖 " : "") + m.name;
    $("#sticky-meta").textContent =
      `Rd ${game.currentRound()}/${game.picksPerManager} · Pick ${game.overallPickNumber()}/${game.totalPicks}` +
      (m.isCpu ? " · CPU…" : "");

    // Last-pick ticker (the draft-room "just selected" strip).
    const ticker = $("#pick-ticker");
    const last = game.pickLog[game.pickLog.length - 1];
    if (last) {
      const slotTxt = last.slot === "COACH" ? "🧠 COACH" : last.slot;
      ticker.innerHTML =
        `<span class="pt-label">Last pick</span> #${last.overall} <b>${last.player.name}</b> · ${slotTxt} → ${last.managerName}`;
      ticker.classList.remove("hidden");
    } else {
      ticker.classList.add("hidden");
    }

    const up = $("#upcoming-list");
    up.innerHTML = "";
    game.upcoming(8).slice(1).forEach((p) => {
      up.appendChild(el("span", "up-chip", `#${p.overall} <b>${p.manager.name}</b>`));
    });

    // Draft-completion progress bar (thin strip under the header row).
    const fill = $("#draft-progress-fill");
    if (fill) fill.style.width = Math.round((game.pickLog.length / game.totalPicks) * 100) + "%";

    // Pulse the Players tab + light up the whole header whenever a human on
    // this device is on the clock.
    const yourTurn = !m.isCpu && (!ui.live || myTurn());
    $("#draft-sticky").classList.toggle("live-turn", yourTurn);
    $("#draft-tabs").querySelectorAll(".dt").forEach((b) => {
      if (b._tab === "players") b.classList.toggle("alert", yourTurn);
    });

    const banner = $("#must-fill-banner");
    const needStarters = game.unfilledStarterSlots(m);
    const needCoach = game.needsCoach(m);
    if (game.auction && !ui.auction) {
      banner.textContent = `🔨 ${m.name}: your nomination — put a player on the block; the highest bid wins them.`;
      banner.classList.remove("hidden");
    } else if (needStarters.length || needCoach) {
      const bits = [];
      if (needStarters.length) {
        bits.push(ui.posMode === "flexible"
          ? `${needStarters.length} starter slot(s)`
          : needStarters.join(", "));
      }
      if (needCoach) bits.push("a head coach 🧠");
      banner.textContent = `⚠️ ${m.name} still needs: ${bits.join(" · ")}`;
      banner.classList.remove("hidden");
    } else {
      banner.classList.add("hidden");
    }

    // Budget now lives in the always-visible #my-status strip (renderMyStatus),
    // so the legacy cap-status line stays hidden to avoid duplication.
    $("#cap-status").classList.add("hidden");
  }

  // What's on the board right now: players within the selected eras, plus the
  // available coaches when coaches are enabled and this manager hasn't hired one
  // (coaches can be drafted at any time, like a sixth position).
  function availablePlayers() {
    let list = PLAYER_POOL.filter((p) => game.isAvailable(p.id) && poolAllowed(p));
    const m = game.currentManager();
    if (ui.coachMode && m && game.needsCoach(m) && typeof COACH_POOL !== "undefined") {
      list = list.concat(COACH_POOL.filter((c) => game.isAvailable(c.id)));
    }
    return list;
  }

  // Salary-cap helpers.
  function minAvailableSalary() {
    let min = Infinity;
    for (const p of PLAYER_POOL) {
      if (!game.isAvailable(p.id) || !poolAllowed(p)) continue;
      const s = salaryOf(p);
      if (s < min) min = s;
    }
    return min === Infinity ? 2 : min;
  }
  // Budget every manager must reserve for a coach: the N-th cheapest coach (N =
  // number of managers). Even if the cheaper coaches get drafted ahead of you in
  // the snake, at least one affordable coach is guaranteed to remain.
  function coachReserve() {
    if (!ui.coachMode || typeof COACH_POOL === "undefined") return 0;
    const sals = COACH_POOL.map((c) => salaryOf(c)).sort((a, b) => a - b);
    const idx = Math.min(game.managers.length - 1, sals.length - 1);
    return sals[idx] || 0;
  }
  function canAfford(manager, player) {
    if (!ui.capMode) return true;
    let reserve = 0;
    if (player.isCoach) {
      // Drafting the coach: nothing left to reserve for.
    } else {
      const slotsLeftAfter = manager.starters
        ? STARTER_SLOTS.filter((s) => !manager.starters[s]).length - 1
        : 0;
      reserve = Math.max(0, slotsLeftAfter) * minAvailableSalary();
      // Still need to leave room for a coach if we haven't hired one yet.
      if (ui.coachMode && !manager.coach) reserve += coachReserve();
    }
    return managerSpent(manager) + salaryOf(player) + reserve <= capAmount();
  }
  // Legal to draft right now: roster rules + era + (in cap mode) affordability.
  // Auction: NOMINATABLE if anyone in the room could legally bid on them (the
  // nominator doesn't have to be able to afford their own nomination).
  function isDraftable(manager, player) {
    const eraOk = player.isCoach || poolAllowed(player); // coaches aren't era/challenge-gated
    if (game.auction) {
      return game.isAvailable(player.id) && eraOk && eligibleBidders(player).length > 0;
    }
    return game.canDraft(manager, player) && eraOk && canAfford(manager, player);
  }

  function visiblePlayers() {
    const m = game.currentManager();
    let list = availablePlayers();

    // Position filter: COACH → coaches only; a position → players at that slot;
    // ALL → everything (players and any available coaches mixed in).
    if (ui.posFilter === "COACH") list = list.filter((p) => p.isCoach);
    else if (ui.posFilter !== "ALL") list = list.filter((p) => !p.isCoach && p.eligible.includes(ui.posFilter));

    if (ui.search) list = list.filter((p) => p.name.toLowerCase().includes(ui.search));

    // Sort keys that work for both players and coaches.
    if (ui.sortBy === "fit") {
      return list.map((p) => ({ p, k: bestFit(m, p) })).sort((a, b) => b.k - a.k).map((x) => x.p);
    }
    const keyFns = {
      career: (p) => (p.isCoach ? p.overall : careerRating(p)),
      peak: (p) => (p.isCoach ? p.overall : peakOverall(p)),
      winner: (p) => (p.isCoach ? p.overall - 5 : p.career.winning),
      durable: (p) => (p.isCoach ? 50 : 100 - p.injuryRisk),
    };
    const kf = keyFns[ui.sortBy] || keyFns.career;
    return list.map((p) => ({ p, k: kf(p) })).sort((a, b) => b.k - a.k).map((x) => x.p);
  }

  /** Best fit grade across the player's currently-legal slots for this manager. */
  function bestFit(manager, player) {
    if (player.isCoach) return coachFit(manager, player);
    const slots = game.legalSlotsFor(manager, player).filter((s) => s !== "BENCH");
    if (slots.length === 0) return pickFitGrade(manager, player, "BENCH");
    return Math.max(...slots.map((s) => pickFitGrade(manager, player, s)));
  }

  /** How well a head coach fits a manager's roster (pedigree + style fit). */
  function coachFit(manager, coach) {
    const starters = SCORING.starterPlayers({ starters: manager.starters, bench: [] });
    const adj = starters.length ? SCORING.coachAdjust(starters, coach).delta : 0;
    return coach.overall + adj * 1.5; // pedigree, lifted/dragged by style fit
  }

  // ---- Pick queue (watchlist): star players; auto-pick drafts from it ------
  function toggleQueue(pid) {
    const i = ui.queue.indexOf(pid);
    if (i >= 0) ui.queue.splice(i, 1);
    else ui.queue.push(pid);
    renderQueueStrip();
    renderPlayerList();
  }
  function renderQueueStrip() {
    const strip = $("#queue-strip");
    const ids = ui.queue.filter((id) => game.isAvailable(id));
    ui.queue = ids; // prune drafted players
    if (!ids.length) {
      strip.classList.add("hidden");
      strip.innerHTML = "";
      return;
    }
    strip.classList.remove("hidden");
    strip.innerHTML = "";
    strip.appendChild(el("span", "qs-label", "⭐ My queue"));
    ids.forEach((id, i) => {
      const p = findDraftable(id);
      if (!p) return;
      const chip = el("span", "qs-chip", `${i + 1}. ${p.name} <b class="qs-x">✕</b>`);
      chip.onclick = () => toggleQueue(id);
      strip.appendChild(chip);
    });
    strip.appendChild(el("span", "qs-hint", "clock expiry drafts from your queue first"));
  }

  function renderPlayerList() {
    const m = game.currentManager();
    const cpuOnClock = m.isCpu;
    const locked = ui.live && !myTurn(); // in a live room, only the on-clock seat drafts
    const list = $("#player-list");
    list.innerHTML = "";
    const players = visiblePlayers();

    if (players.length === 0) {
      list.appendChild(el("p", "muted", "No available players match your filters."));
      return;
    }

    const frag = document.createDocumentFragment();
    const auctionLive = !!(game.auction && ui.auction);
    let bestTagged = false; // marquee-highlight the top draftable name
    players.forEach((p) => {
      const affordable = !ui.capMode || game.auction || canAfford(m, p);
      const canDraft = game.auction
        ? !cpuOnClock && !locked && !auctionLive && isDraftable(m, p)
        : !cpuOnClock && !locked && game.canDraft(m, p) && affordable;
      const isTop = !bestTagged && canDraft && !p.isCoach;
      if (isTop) bestTagged = true;

      const row = el("div", "player-row" + (p.isCoach ? " coach-row" : "") + (isTop ? " top-pick" : "") + (canDraft ? "" : " disabled"));
      const photo = playerPhoto(p, p.isCoach ? p.overall : careerRating(p));
      const salTag = ui.capMode
        ? `<span class="tag salary${!affordable ? " unaffordable" : ""}" title="Salary (of a $${capAmount()} cap)">$${salaryOf(p)}</span>`
        : "";
      const meta = el("div", "player-meta");

      if (p.isCoach) {
        const t = p.traits;
        const fit = Math.round(coachFit(m, p));
        meta.innerHTML = `
          <div class="pname">🧠 ${p.name} <span class="hc-badge" title="Head coach">HC</span></div>
          <div class="psub">
            <span class="tag pos">${p.style}</span>
            ${salTag}
            <span class="tag" title="Coaching pedigree">Coach ${p.overall}</span>
            <span class="tag" title="Offensive acumen">Off ${t.off}</span>
            <span class="tag" title="Defensive acumen">Def ${t.def}</span>
            <span class="tag" title="Pace / transition">Pace ${t.pace}</span>
            <span class="tag fit">Fit ${fit}</span>
          </div>`;
      } else {
        const fit = Math.round(bestFit(m, p));
        meta.innerHTML = `
          <div class="pname">${tierBadge(p)} ${p.name} ${injuryDot(p.injuryRisk)}${isTop ? '<span class="bap">⭐ Best available</span>' : ""}</div>
          <div class="psub">
            <span class="tag pos">${p.eligible.join("/")}</span>
            ${salTag}
            <span class="tag" title="Career-peak ability">Peak ${peakOverall(p)}</span>
            <span class="tag" title="Clutch shot-making">Clutch ${p.ext.clutch}</span>
            <span class="tag" title="Usage rate (ball dominance ${p.career.ballDominance})">${SCORING.usageTier(p)}</span>
            <span class="tag">${p.archetype}</span>
            ${ui.sortBy === "fit" || canDraft ? `<span class="tag fit">Fit ${fit}</span>` : ""}
          </div>`;
      }

      const actions = el("div", "player-actions");
      // Star/queue toggle (players only; any human can plan ahead).
      if (!p.isCoach && !cpuOnClock) {
        const inQ = ui.queue.includes(p.id);
        const star = el("button", "btn ghost mini star-btn" + (inQ ? " on" : ""), inQ ? "★" : "☆");
        star.title = inQ ? "Remove from my queue" : "Add to my queue (auto-pick priority)";
        star.onclick = () => toggleQueue(p.id);
        actions.appendChild(star);
      }
      if (canDraft) {
        const label = game.auction ? "Nominate 🔨" : p.isCoach ? "Hire" : "Draft";
        const btn = el("button", "btn primary mini", label);
        btn.onclick = () => onDraftClick(p);
        actions.appendChild(btn);
      } else if (auctionLive) {
        actions.appendChild(el("span", "slot-sub", "🔨 auction live"));
      } else if (cpuOnClock) {
        actions.appendChild(el("span", "slot-sub", "🤖 CPU"));
      } else if (locked) {
        actions.appendChild(el("span", "slot-sub", "⏳ waiting"));
      } else if (ui.capMode && !affordable) {
        actions.appendChild(el("span", "slot-sub", "💰 over cap"));
      } else {
        actions.appendChild(el("span", "slot-sub", p.isCoach ? "—" : "No legal slot"));
      }

      row.appendChild(photo);
      row.appendChild(meta);
      row.appendChild(actions);
      frag.appendChild(row);
    });
    list.appendChild(frag);
  }

  /** NBA-Jam-style head sprite: headshot (with retro filter via CSS) + the
   *  career rating overlaid, falling back to an initials avatar on any miss. */
  function playerPhoto(p, ovr) {
    const wrap = el("div", "player-photo noimg");
    wrap.innerHTML =
      `<span class="ph-initials">${p.initials || "?"}</span>` +
      `<span class="ph-ovr" style="color:${ovrColor(ovr)}">${ovr}</span>`;
    if (p.photo) {
      const img = document.createElement("img");
      img.src = p.photo;
      img.alt = p.name;
      img.loading = "lazy";
      img.decoding = "async";
      img.onload = () => wrap.classList.remove("noimg");
      img.onerror = () => img.remove(); // keep the initials avatar
      wrap.insertBefore(img, wrap.firstChild);
    }
    return wrap;
  }

  function ovrColor(ovr) {
    if (ovr >= 90) return "#ff6b35";
    if (ovr >= 82) return "#4aa3ff";
    if (ovr >= 74) return "#3ddc84";
    return "#2a2f3a";
  }

  // ---- Drafting flow -----------------------------------------------------
  function onDraftClick(player) {
    // Auction: clicking Nominate puts the player on the block.
    if (game.auction) {
      openAuction(player);
      return;
    }
    const m = game.currentManager();
    const slots = game.legalSlotsFor(m, player);
    if (slots.length === 0) return;
    // Coaches and flexible-mode picks auto-arrange — no manual slot picker.
    // Prefer the player's natural position when it's one of the valid slots.
    if (player.isCoach) {
      commitPick(player, "COACH");
      return;
    }
    if (game.posMode === "flexible") {
      const slot = slots.includes(player.pos) ? player.pos : slots[0];
      commitPick(player, slot);
      return;
    }
    if (slots.length === 1) {
      commitPick(player, slots[0]);
    } else {
      openSlotModal(player, slots);
    }
  }

  function openSlotModal(player, slots) {
    ui.pendingPlayer = player;
    $("#slot-modal-title").textContent = `Where will ${player.name} play?`;
    $("#slot-modal-sub").textContent =
      `Eligible: ${player.eligible.join(", ")}. Choose a starting slot or send to the bench.`;
    const wrap = $("#slot-options");
    wrap.innerHTML = "";
    slots.forEach((s) => {
      const o = el("div", "so", s === "BENCH" ? "Bench" : s);
      o.onclick = () => {
        closeModal();
        commitPick(player, s);
      };
      wrap.appendChild(o);
    });
    $("#slot-modal").classList.remove("hidden");
  }

  function closeModal() {
    $("#slot-modal").classList.add("hidden");
    ui.pendingPlayer = null;
  }

  function commitPick(player, slot) {
    game.draft(player, slot);
    if (ui.live) {
      // Broadcast the new pick list; the room watch echoes it back to everyone
      // (including us) as the single source of truth. Optimistic local render.
      const picks = game.pickLog.map((e) => [e.player.id, e.slot]);
      FBSync.writePicks(ui.roomId, picks);
    } else {
      pushOnlineState(); // keep the shareable link in sync with every pick
    }
    renderDraft();
  }

  // ---- Draft board: every pick, in order, by team ------------------------
  function renderDraftBoard() {
    const wrap = $("#draft-board");
    wrap.innerHTML = "";
    const rounds = game.picksPerManager;

    const byMgrRound = {};
    if (game.auction) {
      // Auction: a manager can win several players in one nomination "round",
      // so stack each manager's purchases sequentially (1st buy = row 1, …).
      game.pickLog.forEach((e) => {
        const list = (byMgrRound[e.managerId] = byMgrRound[e.managerId] || {});
        let r = 1;
        while (list[r]) r++;
        list[r] = e;
      });
    } else {
      game.pickLog.forEach((e) => {
        (byMgrRound[e.managerId] = byMgrRound[e.managerId] || {})[e.round] = e;
      });
    }
    const curId = game.isComplete ? -1 : game.currentManager().id;
    const curRound = game.isComplete || game.auction ? -1 : game.currentRound();

    game.managers.forEach((m) => {
      const col = el("div", "db-col" + (m.id === curId ? " on-clock" : ""));
      // In cap mode the column header shows total spent, so you can see where the
      // money went in real time.
      const headTxt = (m.isCpu ? "🤖 " : "") + m.name + (ui.capMode ? ` · $${managerSpent(m)}` : "");
      col.appendChild(el("div", "db-head", headTxt));
      for (let rd = 1; rd <= rounds; rd++) {
        const e = byMgrRound[m.id] && byMgrRound[m.id][rd];
        const isCurrent = m.id === curId && rd === curRound;
        const cell = el("div", "db-cell" + (e ? "" : " empty") + (isCurrent ? " current" : ""));
        if (e) {
          const isCoach = e.player.isCoach;
          const ovr = isCoach ? `Coach ${e.player.overall}` : `${careerRating(e.player)} ovr`;
          // Auction boards show the hammer price actually paid.
          const salPart = ui.capMode ? ` · $${game.auction ? e.price || 0 : salaryOf(e.player)}` : "";
          cell.innerHTML =
            `<span class="db-pick-no">#${e.overall} · ${isCoach ? "🧠 COACH" : e.slot}</span>` +
            `<span class="db-name">${e.player.name}</span>` +
            `<span class="db-sub">${ovr}${salPart}</span>`;
          if (isCoach) cell.classList.add("coach-cell");
        } else {
          cell.innerHTML =
            `<span class="db-pick-no">R${rd}</span>` +
            `<span>${isCurrent ? "picking…" : "—"}</span>`;
        }
        col.appendChild(cell);
      }
      wrap.appendChild(col);
    });
  }

  // ---- Team-needs guidance for the manager on the clock ------------------
  const NEED_LABELS = {
    creation: "a #1 scorer", rim: "rim protection", spacing: "shooting / spacing",
    playmaking: "a playmaker", perimeterD: "perimeter defense", rebounding: "rebounding",
  };

  function renderTeamNeeds() {
    const wrap = $("#team-needs");
    const m = game.currentManager();

    const a = SCORING.analyzeRoster({ starters: m.starters, bench: [] });

    const strengthChips = a.strengths
      .map((i) => `<span class="tn-chip good" title="${i.have}">✓ ${i.label}</span>`)
      .join("");
    const gapChips = a.gaps
      .map((i) => `<span class="tn-chip bad" title="${i.miss}">✗ ${i.label}</span>`)
      .join("");
    const coachChip = game.needsCoach(m) ? `<span class="tn-chip bad">✗ head coach 🧠</span>` : "";
    const haveRow = strengthChips || `<span class="tn-chip">No picks yet</span>`;

    const openSlots = a.openPositions.slice();
    if (game.needsCoach(m)) openSlots.push("Coach");
    const openTxt = openSlots.length ? `<b>${openSlots.join(", ")}</b>` : "all set";

    // Recommend the best player; if only the coach remains, recommend a coach.
    let recHtml;
    const rec = recommendPick(m, a);
    if (rec) {
      recHtml = `💡 <b>Target:</b> ${rec.text}`;
    } else if (game.needsCoach(m)) {
      const coaches = (typeof COACH_POOL !== "undefined" ? COACH_POOL : []).filter((c) => isDraftable(m, c));
      coaches.sort((x, y) => coachFit(m, y) - coachFit(m, x));
      const top = coaches[0];
      recHtml = top
        ? `💡 <b>Hire a coach:</b> <b>${top.name}</b> (${top.style}) — ${SCORING.coachAdjust(SCORING.starterPlayers({ starters: m.starters, bench: [] }), top).note}.`
        : "Your roster is set.";
    } else {
      recHtml = "Your roster is set.";
    }

    wrap.innerHTML =
      `<div class="tn-title">${m.isCpu ? "🤖 " : ""}${m.name} — what your team has & needs</div>` +
      `<div class="tn-row">${haveRow}${gapChips}${coachChip}</div>` +
      `<div class="tn-open">Open: ${openTxt}</div>` +
      `<div class="tn-rec">${recHtml}</div>`;
  }

  /** Suggest the best complementary pick available for this roster. */
  function recommendPick(manager, analysis) {
    const avail = PLAYER_POOL.filter((p) => isDraftable(manager, p));
    if (avail.length === 0) return null;
    avail.sort((x, y) => bestFit(manager, y) - bestFit(manager, x));
    const top = avail[0];

    const slots = game.legalSlotsFor(manager, top).filter((s) => s !== "BENCH");
    const slot = slots.includes(top.pos) ? top.pos : slots[0] || top.pos;

    const gapKeys = new Set(analysis.gaps.map((g) => g.key));
    const provided = SCORING.traitsProvided(top).filter((k) => gapKeys.has(k));

    let why;
    if (provided.length) {
      why = `adds ${provided.map((k) => NEED_LABELS[k]).join(" & ")}`;
    } else if (analysis.gaps.length) {
      why = `best value available — your biggest gap is ${NEED_LABELS[analysis.gaps[0].key]}`;
    } else {
      why = "best all-around value available";
    }

    const text = `<b>${top.name}</b> at <b>${slot}</b> — ${why} ` +
      `(Career ${careerRating(top)}, Fit ${Math.round(bestFit(manager, top))}).`;
    return { player: top, slot, text };
  }

  // ---- Roster panel (all teams visible the whole draft) ------------------
  function renderAllRosters() {
    const wrap = $("#all-rosters");
    wrap.innerHTML = "";
    const onClockId = game.isComplete ? -1 : game.currentManager().id;

    // In a live room, pin YOUR team to the top so it's one tap to check.
    const mgrs = game.managers.slice();
    if (ui.live && ui.mySeat != null) {
      mgrs.sort((a, b) => (a.id === ui.mySeat ? -1 : b.id === ui.mySeat ? 1 : a.id - b.id));
    }

    mgrs.forEach((m) => {
      const filled = SCORING.starterPlayers({ starters: m.starters, bench: [] }).length;
      const isMe = ui.live && m.id === ui.mySeat;
      const card = el("div", "team-card" + (m.id === onClockId ? " on-clock" : ""));

      const head = el("div", "team-card-head");
      head.innerHTML =
        `<span class="team-name">${m.isCpu ? "🤖 " : ""}${m.name}${isMe ? ' <span class="you-badge">YOU</span>' : ""}</span>` +
        `<span class="team-fill">${filled}/5${m.id === onClockId ? " · on the clock" : ""}</span>`;
      card.appendChild(head);

      STARTER_SLOTS.forEach((slot) => card.appendChild(slotRow(slot, m.starters[slot])));
      if (ui.coachMode) {
        const crow = el("div", "slot-row coach-slot-row" + (m.coach ? "" : " empty"));
        crow.appendChild(el("div", "slot-key", "🧠"));
        if (m.coach) {
          const info = el("div");
          info.innerHTML = `<div class="slot-player">${m.coach.name}</div>
            <div class="slot-sub">${m.coach.style}</div>`;
          crow.appendChild(info);
          crow.appendChild(el("div", "slot-ovr", String(m.coach.overall)));
        } else {
          crow.appendChild(el("div", "slot-sub", "— no coach —"));
          crow.appendChild(el("div", "slot-ovr", ""));
        }
        card.appendChild(crow);
      }
      wrap.appendChild(card);
    });
  }

  function slotRow(slotKey, player) {
    const row = el("div", "slot-row" + (player ? "" : " empty"));
    row.appendChild(el("div", "slot-key", slotKey));
    if (player) {
      const info = el("div");
      info.innerHTML = `<div class="slot-player">${player.name} ${injuryDot(player.injuryRisk)}</div>
        <div class="slot-sub">${player.pos} · Peak ${peakOverall(player)}</div>`;
      row.appendChild(info);
      row.appendChild(el("div", "slot-ovr", String(careerRating(player))));
    } else {
      row.appendChild(el("div", "slot-sub", "— empty —"));
      row.appendChild(el("div", "slot-ovr", ""));
    }
    return row;
  }

  // ========================================================================
  //  RESULTS SCREEN
  // ========================================================================
  function showResults() {
    const results = game.managers.map((m) => ({
      manager: m,
      eval: evaluateRoster({ starters: m.starters, bench: m.bench, coach: m.coach }),
    }));
    results.sort((a, b) => b.eval.composite - a.eval.composite);
    ui.resultTeam = 0; // default to the champion's analysis

    renderPodium(results);
    renderBracket(results, false);
    renderDraftGrades();
    renderResultsDetail(results);
    initLegendsUI(results);
    showScreen("#results-screen");

    // Pop the final standings the moment the draft ends: who won, in what
    // order, and (in a live room) where YOU finished.
    if (!ui.finalShown) {
      ui.finalShown = true;
      showFinalModal(results);
    }

    $("#share-results").onclick = () => {
      // A self-contained link (full draft encoded in the hash) that shows these
      // exact results to anyone who opens it — no room/Firebase needed to view.
      const url = location.origin + location.pathname + "#g=" + encodeGameState();
      const btn = $("#share-results");
      const done = () => {
        btn.textContent = "✅ Results link copied!";
        setTimeout(() => (btn.textContent = "📋 Copy results link to share"), 2500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, () => prompt("Copy this results link:", url));
      } else {
        prompt("Copy this results link:", url);
      }
    };

    $("#play-again").onclick = () => {
      // Clear any shared-link state so a new draft starts fresh.
      history.replaceState(null, "", location.pathname + location.search);
      location.reload();
    };
  }

  // ========================================================================
  //  POSTSEASON THEATER: bracket finale, draft grades, legend gauntlet
  // ========================================================================
  const draftSeedString = () => game.pickLog.map((e) => e.player.id).join("|");
  const profileOf = (r) =>
    POSTSEASON.teamProfile(
      (r.manager.isCpu ? "🤖 " : "") + r.manager.name,
      { starters: r.manager.starters, bench: [], coach: r.manager.coach },
      r.eval
    );

  /** Simulated playoff bracket among the drafted teams (seeded by record). */
  function renderBracket(results, reroll) {
    const wrap = $("#playoff-bracket");
    if (results.length < 2) { wrap.innerHTML = ""; return; }
    const profiles = results.slice().sort((a, b) => b.eval.avgWins - a.eval.avgWins).map(profileOf);
    const seed = reroll ? "reroll·" + Math.random() : draftSeedString();
    const br = POSTSEASON.simBracket(profiles, seed);
    const R = br.rounds.length;
    const roundName = (i) => {
      const left = R - i;
      return left === 1 ? "🏆 Finals" : left === 2 ? "Semifinals" : "First round";
    };
    const roundsHtml = br.rounds
      .map((series, i) => {
        const cards = series
          .map((s) => {
            if (s.bye) return `<div class="bk-series bye"><b>${s.winner}</b> — first-round bye</div>`;
            const log = s.games
              .map((g) => `<div class="bk-game">G${g.g}: <b>${g.winner}</b>${g.close ? " (nail-biter)" : ""} — ${g.star} ${g.pts} pts</div>`)
              .join("");
            return `<div class="bk-series${i === R - 1 ? " finals" : ""}">
              <div class="bk-line">${s.teamA} vs ${s.teamB}</div>
              <div class="bk-win">→ <b>${s.winner}</b> ${s.score}</div>
              <details class="bk-log"><summary>game log</summary>${log}</details>
            </div>`;
          })
          .join("");
        return `<div class="bk-round"><div class="bk-round-name">${roundName(i)}</div>${cards}</div>`;
      })
      .join("");
    wrap.innerHTML =
      `<div class="res-subhead">Simulated postseason — seeded by projected record (upsets happen!)</div>` +
      `<div class="bk-rounds">${roundsHtml}</div>` +
      `<div class="bk-champ">🏆 <b>${br.champion.name}</b> wins the simulated title · Finals MVP: <b>${br.mvp}</b></div>`;
    const resim = el("button", "btn mini", "🎲 Re-simulate the bracket");
    resim.onclick = () => renderBracket(results, true);
    wrap.appendChild(resim);
  }

  /** Grade every pick vs value/draft position (price-aware in auctions). */
  let _gradeById = null;
  function renderDraftGrades() {
    const wrap = $("#draft-grades");
    _gradeById = new Map();
    const picks = game.pickLog.filter((e) => !e.player.isCoach);
    if (picks.length < 4) { wrap.innerHTML = ""; return; }
    const byRating = picks.slice().sort((a, b) => careerRating(b.player) - careerRating(a.player));
    const rank = new Map(byRating.map((e, i) => [e.player.id, i]));
    const n = picks.length;
    const graded = picks.map((e, idx) => {
      let score = idx - rank.get(e.player.id); // positive = value fell to you
      if (game.auction) {
        const fair = proposedValue(e.player);
        score += ((fair - (e.price || fair)) / Math.max(4, fair)) * (n / 6);
      }
      const z = score / Math.max(3, n / 4);
      const letter =
        z >= 1 ? "A+" : z >= 0.6 ? "A" : z >= 0.3 ? "A-" : z >= 0.12 ? "B+" :
        z >= -0.12 ? "B" : z >= -0.3 ? "C+" : z >= -0.6 ? "C" : z >= -1 ? "D" : "F";
      _gradeById.set(e.player.id, letter);
      return { e, score, letter };
    });
    const steal = graded.slice().sort((a, b) => b.score - a.score)[0];
    const reach = graded.slice().sort((a, b) => a.score - b.score)[0];
    const priceTag = (e) => (game.auction && e.price != null ? ` ($${e.price})` : "");
    const GPA = { "A+": 4.3, A: 4, "A-": 3.7, "B+": 3.3, B: 3, "C+": 2.3, C: 2, D: 1, F: 0 };
    const teams = game.managers
      .map((m) => {
        const g = graded.filter((x) => x.e.managerId === m.id);
        return { m, gpa: g.length ? g.reduce((s, x) => s + GPA[x.letter], 0) / g.length : 0 };
      })
      .sort((a, b) => b.gpa - a.gpa);
    wrap.innerHTML =
      `<div class="res-subhead">Draft grades</div>` +
      `<div class="dg-callout good">💎 <b>Steal of the draft:</b> ${steal.e.player.name} — pick #${steal.e.overall} by ${steal.e.managerName}${priceTag(steal.e)}</div>` +
      (reach.score < -1
        ? `<div class="dg-callout bad">🚨 <b>Biggest reach:</b> ${reach.e.player.name} — pick #${reach.e.overall} by ${reach.e.managerName}${priceTag(reach.e)}</div>`
        : "") +
      `<div class="dg-teams">${teams
        .map((t, i) => `<span class="dg-team">${i === 0 ? "🎓 " : ""}${t.m.isCpu ? "🤖 " : ""}${t.m.name} <b>${t.gpa.toFixed(1)} GPA</b></span>`)
        .join("")}</div>`;
  }

  /** Legend gauntlet: your drafted team vs an all-decade super-team. */
  function initLegendsUI(results) {
    $("#challenge-legends").onclick = () => openLegends(results);
    $("#legends-close").onclick = () => $("#legends-modal").classList.add("hidden");
  }
  function openLegends(results) {
    const opts = $("#legends-options");
    opts.innerHTML = "";
    const teamSel = el("select", "lg-select");
    results.forEach((r, i) => {
      const o = el("option", null, `${r.manager.isCpu ? "🤖 " : ""}${r.manager.name}`);
      o.value = String(i);
      teamSel.appendChild(o);
    });
    opts.appendChild(el("div", "lg-label", "Your team"));
    opts.appendChild(teamSel);
    opts.appendChild(el("div", "lg-label", "Pick a legend squad"));
    const grid = el("div", "lg-grid");
    POSTSEASON.LEGEND_SQUADS.forEach((sq) => {
      const b = el("button", "btn mini lg-squad", `${sq.emoji} ${sq.name}`);
      b.onclick = () => runLegendSeries(results[parseInt(teamSel.value, 10) || 0], sq);
      grid.appendChild(b);
    });
    opts.appendChild(grid);
    $("#legends-result").innerHTML = "";
    $("#legends-modal").classList.remove("hidden");
  }
  function runLegendSeries(r, sq) {
    const mine = profileOf(r);
    const roster = POSTSEASON.legendRoster(sq);
    const legends = POSTSEASON.teamProfile(`${sq.emoji} ${sq.name}`, roster, evaluateRoster(roster));
    const pct = Math.round(POSTSEASON.seriesWinPct(mine, legends, 400) * 100);
    const rnd = POSTSEASON.mulberry32(POSTSEASON.hashStr(mine.name + sq.key + draftSeedString()));
    const hi = mine.strength >= legends.strength ? mine : legends;
    const lo = hi === mine ? legends : mine;
    const s = POSTSEASON.simSeries(hi, lo, rnd);
    const won = s.winner === mine;
    const log = s.games
      .map((g) => `<div class="bk-game">G${g.g}: <b>${g.winner}</b>${g.close ? " (nail-biter)" : ""} — ${g.star} ${g.pts} pts</div>`)
      .join("");
    $("#legends-result").innerHTML =
      `<div class="lg-pct">You'd beat the ${sq.name} in <b>${pct}%</b> of best-of-7s</div>` +
      `<div class="lg-bar"><i style="width:${pct}%"></i></div>` +
      `<div class="bk-series"><div class="bk-line">Showcase series</div>` +
      `<div class="bk-win">→ <b>${s.winner.name}</b> ${s.score} ${won ? "🎉" : "😤"}</div>${log}</div>`;
  }

  const ordinal = (n) => {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  /** Quick end-of-game popup: champion + full ranking (+ your finish, live). */
  function showFinalModal(results) {
    const win = results[0];
    $("#final-title").textContent = `🏆 ${win.manager.name} wins the dynasty!`;

    const meIdx =
      ui.live && ui.mySeat != null ? results.findIndex((r) => r.manager.id === ui.mySeat) : -1;
    $("#final-sub").textContent =
      meIdx >= 0
        ? `You finished ${ordinal(meIdx + 1)} of ${results.length}. Final composite scores over the 15-year run:`
        : `Final standings — composite scores over the 15-year run:`;

    const wrap = $("#final-rankings");
    wrap.innerHTML = "";
    const medals = ["🥇", "🥈", "🥉"];
    results.forEach((r, i) => {
      const isMe = i === meIdx;
      wrap.appendChild(el(
        "div",
        "fr-row" + (isMe ? " me" : ""),
        `<span class="fr-rank">${medals[i] || "#" + (i + 1)}</span>
         <span class="fr-name">${r.manager.isCpu ? "🤖 " : ""}${r.manager.name}${isMe ? ' <span class="you-badge">YOU</span>' : ""}</span>
         <span class="fr-score">${Math.round(r.eval.composite)}</span>`
      ));
    });

    $("#final-close").onclick = () => $("#final-modal").classList.add("hidden");
    $("#final-modal").classList.remove("hidden");
    confettiBurst();
    SFX.play("champion");
  }

  /** Lightweight confetti drop for the championship moment (pure CSS/JS). */
  function confettiBurst() {
    const body = document.body;
    if (!body || typeof body.appendChild !== "function") return;
    const wrap = el("div", "confetti");
    const colors = ["#ff6b35", "#ffd54a", "#4aa3ff", "#3ddc84", "#b06bff", "#ff5d5d"];
    for (let i = 0; i < 70; i++) {
      const c = el("i");
      c.style.left = Math.random() * 100 + "%";
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = (Math.random() * 0.9).toFixed(2) + "s";
      c.style.animationDuration = (2.4 + Math.random() * 1.8).toFixed(2) + "s";
      wrap.appendChild(c);
    }
    body.appendChild(wrap);
    setTimeout(() => wrap.remove(), 5500);
  }

  function renderPodium(results) {
    const wrap = $("#results-podium");
    wrap.innerHTML = "";
    const medals = ["🥇", "🥈", "🥉"];
    results.forEach((r, i) => {
      const card = el("div", "podium-card" + (i === 0 ? " rank-1" : ""));
      card.innerHTML = `
        <div class="podium-rank">${medals[i] || `#${i + 1}`}</div>
        <div class="podium-name">${r.manager.name}</div>
        <div class="podium-record">Avg record ${r.eval.avgRecord}</div>
        <div class="podium-record">🏆 ${r.eval.championships} title${r.eval.championships === 1 ? "" : "s"} · peak ${r.eval.bestRecord}</div>
        <div class="podium-score">${Math.round(r.eval.composite)}</div>`;
      wrap.appendChild(card);
    });
  }

  function renderResultsDetail(results) {
    // Declutter: show ONE team's analysis at a time behind a tab selector.
    const tabs = $("#results-teamtabs");
    tabs.innerHTML = "";
    results.forEach((r, i) => {
      const label = `${i === 0 ? "🏆 " : "#" + (i + 1) + " "}${r.manager.isCpu ? "🤖 " : ""}${r.manager.name}`;
      const b = el("button", "rtt" + (i === 0 ? " active" : ""), label);
      b.onclick = () => showResultTeam(results, i);
      tabs.appendChild(b);
    });
    showResultTeam(results, Math.min(ui.resultTeam || 0, results.length - 1));
  }

  function showResultTeam(results, i) {
    ui.resultTeam = i;
    $("#results-teamtabs").querySelectorAll(".rtt").forEach((b, idx) => b.classList.toggle("active", idx === i));
    const wrap = $("#results-detail");
    wrap.innerHTML = "";
    wrap.appendChild(buildTeamCard(results[i], i));
  }

  function buildTeamCard(r, i) {
    {
      const ev = r.eval;
      const m = r.manager;
      const team = el("div", "res-team");

      // Clean position-by-position roster (+ coach row when coaches are on).
      let rosterRows = STARTER_SLOTS.map((slot) => {
        const p = m.starters[slot];
        if (!p) return `<div class="res-slot empty"><span class="res-pos">${slot}</span><span class="res-pname">— empty —</span></div>`;
        const gr = _gradeById && _gradeById.get(p.id);
        return `<div class="res-slot">
            <span class="res-pos">${slot}</span>
            <span class="res-pname">${tierBadge(p)} ${p.name}</span>
            ${gr ? `<span class="res-grade">${gr}</span>` : ""}
            <span class="res-ptag">${SCORING.usageTier(p)}</span>
            <span class="res-prate">${careerRating(p)}</span>
          </div>`;
      }).join("");
      if (ui.coachMode) {
        rosterRows += m.coach
          ? `<div class="res-slot coach"><span class="res-pos">🧠</span>
               <span class="res-pname">${m.coach.name}</span>
               <span class="res-ptag">${m.coach.style}</span>
               <span class="res-prate">${m.coach.overall}</span></div>`
          : `<div class="res-slot empty"><span class="res-pos">🧠</span><span class="res-pname">— no coach —</span></div>`;
      }

      // Strengths & weaknesses.
      const sw = SCORING.teamStrengthsWeaknesses({ starters: m.starters, bench: [] });
      const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
      const swList = (arr, cls, empty) =>
        arr.length
          ? arr.map((t) => `<li class="${cls}">${cap(t)}</li>`).join("")
          : `<li class="muted">${empty}</li>`;

      // Notable teammate pairings + team-level construction (duplication /
      // spacing) call-outs + the head coach, shown together as the chemistry
      // breakdown.
      const rosterRef = { starters: m.starters, bench: [], coach: m.coach };
      const syn = SCORING.synergyNotes(rosterRef);
      const cons = SCORING.constructionNotes(rosterRef);
      const coachNoteTxt = SCORING.coachNote(rosterRef);
      const coachItems = coachNoteTxt ? [{ kind: "good", text: coachNoteTxt }] : [];
      const chemItems = coachItems.concat(cons, syn);
      const synHtml = chemItems.length
        ? `<div class="res-subhead">Chemistry, spacing &amp; notable pairings</div>
           <ul class="res-pairings">${chemItems.map((s) => `<li class="${s.kind}">${s.text}</li>`).join("")}</ul>`
        : "";

      // Advanced efficiency read — TS% / turnovers / estimated impact, surfaced
      // only now (post-finalization) so inefficient picks are exposed at the end.
      const eff = SCORING.efficiencyAnalysis(rosterRef);
      const effNotesHtml = eff.notes.length
        ? `<ul class="res-pairings">${eff.notes.map((s) => `<li class="${s.kind}">${s.text}</li>`).join("")}</ul>`
        : `<p class="muted" style="margin:6px 0 0">No efficiency red flags — the shot quality holds up.</p>`;
      const topImp = eff.impacts.slice(0, 2).map((x) => `${x.name} ${x.impact >= 0 ? "+" : ""}${x.impact}`).join(", ");
      const botImp = eff.impacts.slice(-1).map((x) => `${x.name} ${x.impact >= 0 ? "+" : ""}${x.impact}`).join("");
      const effHtml = `
        <div class="res-subhead">Advanced efficiency (post-draft reveal)</div>
        <div class="res-eff">
          <span class="eff-pill" title="Usage-weighted team true-shooting proxy">Team TS ${eff.teamTS}</span>
          <span class="eff-pill" title="Usage-weighted team turnover rate (lower is better)">Team TOV ${eff.teamTOV}</span>
          <span class="eff-pill" title="Estimated plus-minus / on-off impact">Top impact: ${topImp}</span>
          ${eff.impacts.length > 2 ? `<span class="eff-pill" title="Lowest estimated impact starter">Lowest: ${botImp}</span>` : ""}
        </div>
        ${effNotesHtml}`;

      // Prose recap of the 15-year run — highs, lows, what worked & didn't.
      const narrative = SCORING.careerNarrative(rosterRef, ev);
      const narrativeHtml = narrative
        ? `<div class="res-subhead">The 15-year run</div>
           <p class="res-narrative">${narrative}</p>`
        : "";

      // Win timeline, color-coded by how deep each season went.
      const maxWins = 73;
      const bars = ev.seasons
        .map((s, idx) => {
          const h = Math.round((s.wins / maxWins) * 100);
          const cls = s.playoffIndex >= 84 ? " gold" : s.playoffIndex >= 70 ? " hot" : s.playoffIndex < 20 ? " cold" : "";
          return `<div class="bar${cls}" style="height:${h}%" data-tip="Yr ${idx + 1}: ${Math.round(s.wins)}-${Math.round(82 - s.wins)} · ${playoffLabel(s.playoffIndex)}"></div>`;
        })
        .join("");
      const tlLegend =
        `<div class="tl-legend"><span><i class="tl-k gold"></i>Title favorite</span>` +
        `<span><i class="tl-k hot"></i>Finals-level</span>` +
        `<span><i class="tl-k"></i>Playoffs</span>` +
        `<span><i class="tl-k cold"></i>Lottery</span></div>`;

      team.innerHTML = `
        <h4>${i === 0 ? "🏆 " : `#${i + 1} `}${m.isCpu ? "🤖 " : ""}${m.name}</h4>
        <div class="res-stats">
          <div class="res-stat"><b>${ev.avgRecord}</b>Avg season record</div>
          <div class="res-stat"><b>${ev.bestRecord}</b>Best record at peak</div>
          <div class="res-stat"><b>${ev.championships}</b>Total championships won</div>
          <div class="res-stat"><b>${playoffLabel(ev.avgPlayoffIndex)}</b>Typical postseason</div>
          <div class="res-stat"><b>${ev.cohesion}</b>Team cohesion</div>
          <div class="res-stat"><b>${Math.round(ev.composite)}</b>Composite score</div>
        </div>
        <div class="res-cols">
          <div class="res-rostercard">
            <div class="res-subhead">Starting five</div>
            ${rosterRows}
          </div>
          <div class="res-swcard">
            <div class="res-subhead">Team summary</div>
            <div class="res-sw">
              <div><div class="sw-head good">Strengths</div><ul>${swList(sw.strengths, "good", "No standout strengths")}</ul></div>
              <div><div class="sw-head bad">Weaknesses</div><ul>${swList(sw.weaknesses, "bad", "No glaring weaknesses")}</ul></div>
            </div>
          </div>
        </div>
        ${synHtml}
        ${effHtml}
        ${narrativeHtml}
        <div class="res-subhead">15-year win trajectory</div>
        <div class="timeline">${bars}</div>
        ${tlLegend}`;
      return team;
    }
  }

  // ---- Boot --------------------------------------------------------------
  function boot() {
    initSetup();
    // Live room link → join the real-time room.
    const room = location.hash.match(/[#&]room=([^&]+)/);
    if (room) {
      if (liveAvailable()) {
        joinLiveRoom(room[1]);
      } else {
        // Firebase not configured on this deployment — explain rather than hang.
        alert(
          "This is a live draft link, but live sync isn't configured on this site yet.\n\n" +
          "Add a Firebase config (see js/firebase-config.js) to enable real-time rooms."
        );
      }
      return;
    }
    // Self-contained shared/results link → reconstruct from the hash.
    if (loadFromHash()) {
      ui.gameGen++;
      buildDraftStaticUI();
      ui.staticBuilt = true;
      if (game.isComplete) {
        showResults();
      } else {
        showScreen("#draft-screen");
        renderDraft();
      }
    }
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
