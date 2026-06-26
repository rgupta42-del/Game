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
    draftOrder: null, // explicit pick order (persisted for random-order replay)
    turnGatePick: null, // (online) pickLog length for which the human pressed "Go"
    allowedEras: ["80s", "90s", "00s", "10s", "20s"],
  };
  const eraAllowed = (p) => (p.eras || []).some((d) => ui.allowedEras.includes(d));
  const salaryOf = (p) => (p.isCoach ? SCORING.coachSalary(p) : SCORING.salaryValue(p));
  // Chosen cap, defaulting to $250 with coaches / $200 without.
  const capAmount = () => ui.capChoice || (ui.coachMode ? SCORING.SALARY_CAP_WITH_COACH : SCORING.SALARY_CAP);
  const SALARY_CAP = SCORING.SALARY_CAP; // legacy reference (kept for tooltips)
  const managerSpent = (m) =>
    SCORING.starterPlayers({ starters: m.starters, bench: [] }).reduce((s, p) => s + salaryOf(p), 0) +
    (m.coach ? salaryOf(m.coach) : 0);
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
    let capTouched = false;
    const syncCapUI = () => {
      $("#cap-amount-field").classList.toggle("hidden", !$("#cap-toggle").checked);
      if (!capTouched) $("#cap-amount").value = $("#coach-toggle").checked ? "250" : "200";
    };
    $("#cap-toggle").addEventListener("change", syncCapUI);
    $("#coach-toggle").addEventListener("change", syncCapUI);
    $("#cap-amount").addEventListener("change", () => { capTouched = true; });
    syncCapUI();
  }

  // ---- Online state (share-a-link relay) ---------------------------------
  const b64urlEncode = (s) =>
    btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const b64urlDecode = (s) =>
    decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

  function encodeGameState() {
    const state = {
      n: game.managers.map((m) => m.name),
      p: game.pickLog.map((e) => [e.player.id, e.slot]),
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
      order: ui.draftOrder, // exact order for random-mode replay (else rebuilt)
    });
    // Capture the order the first time (random mode) so it persists for replay.
    if (!ui.draftOrder) ui.draftOrder = game.order.slice();
    (picks || []).forEach((pk) => {
      // pk may be an array [id, slot] or a Firebase object {0:id, 1:slot}.
      const p = findDraftable(pk[0]);
      if (!p || game.isComplete) return;
      try {
        game.draft(p, pk[1]);
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
        // Now that the room exists, the host chooses their (human) seat.
        showSeatModal(names, {});
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
    }
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
      const n = PLAYER_POOL.filter((p) => eraAllowed(p) && p.eligible.includes(pos)).length;
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
    ui.orderMode = ["snake", "linear", "random"].includes($("#order-select").value)
      ? $("#order-select").value : "snake";
    ui.allowedEras = Array.from($("#era-filters").querySelectorAll("input:checked")).map((c) => c.value);
    if (ui.allowedEras.length === 0) return alert("Select at least one era.");
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
    game = new DraftGame(names, {
      benchSize: 0, cpuFlags, posMode: ui.posMode, coachMode: ui.coachMode, orderMode: ui.orderMode,
    });
    ui.draftOrder = game.order.slice(); // capture (matters for random order)
    initCpuProfiles();
    buildDraftStaticUI();
    ui.staticBuilt = true;
    showScreen("#draft-screen");
    if (online) pushOnlineState();
    renderDraft();
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
  function buildDraftStaticUI() {
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
    renderStatus();
    renderSharePanel();
    renderDraftBoard();
    renderTeamNeeds();
    renderPlayerList();
    renderAllRosters();

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
    if (ui.clockSeconds <= 0 || game.isComplete) return;
    if (!ownsClock()) return;
    const m = game.currentManager();
    // Online human turns: don't run the clock until the player hits "Go", so a
    // manager who isn't at their device the moment their turn comes up isn't
    // disadvantaged. CPU clocks (and local pass-and-play) start immediately.
    if (ui.online && m && !m.isCpu) {
      const atPick = game.pickLog.length;
      if (ui.turnGatePick === atPick) {
        startClock();
      } else {
        showTurnGate(atPick);
      }
      return;
    }
    startClock();
  }
  function showTurnGate(atPick) {
    const modal = $("#turn-modal");
    const m = game.currentManager();
    $("#turn-modal-sub").innerHTML =
      `You're <b>${m ? m.name : "up"}</b>. Your ${formatClock(ui.clockSeconds)} pick clock starts when you hit ` +
      `<b>Go</b> — take your time getting here, it won't run until you're ready.`;
    $("#turn-go").onclick = () => {
      ui.turnGatePick = atPick;
      modal.classList.add("hidden");
      startClock();
    };
    modal.classList.remove("hidden");
  }
  const formatClock = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  function startClock() {
    const gen = ui.gameGen;
    ui.clockRemaining = ui.clockSeconds;
    $("#pick-clock").classList.remove("hidden");
    updateClockDisplay();
    ui.clockTimer = setInterval(() => {
      if (gen !== ui.gameGen) return clearInterval(ui.clockTimer);
      ui.clockRemaining -= 1;
      updateClockDisplay();
      if (ui.clockRemaining <= 0) {
        clearInterval(ui.clockTimer);
        const cur = game.currentManager();
        // CPU turns are handled by scheduleCpuPick; only auto-pick for a human
        // who has let their clock expire.
        if (cur && !cur.isCpu) autoPick(cur);
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
    } else {
      copyBtn.textContent = "🔗 Copy link to send";
      turnEl.innerHTML = `🔗 It's <b>${m.name}</b>'s turn`;
      instrEl.textContent =
        `${m.name}: make your pick below, then copy this link and send it to the next manager so they can take their turn.`;
    }
  }

  // ---- CPU autodraft -----------------------------------------------------
  const CPU_DELAY_MS = 500; // local: snappy

  function scheduleCpuPick() {
    if (ui.live || game.isComplete) return; // live handled by scheduleLiveDrivers
    const m = game.currentManager();
    if (!m || !m.isCpu) return;
    closeModal(); // a CPU never uses the manual slot picker
    const gen = ui.gameGen;
    const atPick = game.pickLog.length;
    const delay = ui.online ? 1600 + Math.random() * 1800 : CPU_DELAY_MS;
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
    if (!ui.live || !ui.roomReady || game.isComplete) return;
    const m = game.currentManager();
    if (!m) return;
    const atPick = game.pickLog.length;
    const myRoom = ui.roomId;
    const seated = ui.mySeat != null;

    let delay = null;
    if (m.isCpu) {
      if (ui.isHost) delay = 1600 + Math.random() * 1800; // primary
      else if (seated) delay = 9000 + (ui.mySeat || 0) * 1500 + Math.random() * 1200; // backup
    } else if (ui.clockSeconds > 0 && !myTurn() && (ui.isHost || seated)) {
      // Backup only — the on-clock human's own device handles the normal expiry.
      delay = (ui.clockSeconds + 6) * 1000 + (ui.mySeat || 0) * 1500 + Math.random() * 1200;
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
    $("#onclock-name").textContent = (m.isCpu ? "🤖 " : "") + m.name;
    $("#sticky-onclock").textContent = (m.isCpu ? "🤖 " : "") + m.name;
    $("#onclock-meta").textContent =
      `Round ${game.currentRound()} · Pick #${game.overallPickNumber()} of ${game.totalPicks}` +
      (m.isCpu ? " · CPU drafting…" : "");

    const up = $("#upcoming-list");
    up.innerHTML = "";
    game.upcoming(6).slice(1).forEach((p) => {
      up.appendChild(el("span", "up-chip", `#${p.overall} <b>${p.manager.name}</b>`));
    });

    const banner = $("#must-fill-banner");
    const needStarters = game.unfilledStarterSlots(m);
    const needCoach = game.needsCoach(m);
    if (needStarters.length || needCoach) {
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

    const cap = $("#cap-status");
    if (ui.capMode) {
      const CAP = capAmount();
      const spent = managerSpent(m);
      const left = CAP - spent;
      const coachTxt = ui.coachMode && m.coach ? ` · coach $${salaryOf(m.coach)}` : "";
      cap.innerHTML = `💰 ${m.name}: spent <b>$${spent}</b>${coachTxt} · left <b>$${left}</b> / $${CAP}`;
      cap.classList.toggle("over", left < 0);
      cap.classList.remove("hidden");
    } else {
      cap.classList.add("hidden");
    }
  }

  // What's on the board right now: players within the selected eras, plus the
  // available coaches when coaches are enabled and this manager hasn't hired one
  // (coaches can be drafted at any time, like a sixth position).
  function availablePlayers() {
    let list = PLAYER_POOL.filter((p) => game.isAvailable(p.id) && eraAllowed(p));
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
      if (!game.isAvailable(p.id) || !eraAllowed(p)) continue;
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
  function isDraftable(manager, player) {
    const eraOk = player.isCoach || eraAllowed(player); // coaches aren't era-gated
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
    players.forEach((p) => {
      const affordable = !ui.capMode || canAfford(m, p);
      const canDraft = !cpuOnClock && !locked && game.canDraft(m, p) && affordable;

      const row = el("div", "player-row" + (p.isCoach ? " coach-row" : "") + (canDraft ? "" : " disabled"));
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
          <div class="pname">${tierBadge(p)} ${p.name} ${injuryDot(p.injuryRisk)}</div>
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
      if (canDraft) {
        const btn = el("button", "btn primary mini", p.isCoach ? "Hire" : "Draft");
        btn.onclick = () => onDraftClick(p);
        actions.appendChild(btn);
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
    game.pickLog.forEach((e) => {
      (byMgrRound[e.managerId] = byMgrRound[e.managerId] || {})[e.round] = e;
    });
    const curId = game.isComplete ? -1 : game.currentManager().id;
    const curRound = game.isComplete ? -1 : game.currentRound();

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
          const salPart = ui.capMode ? ` · $${salaryOf(e.player)}` : "";
          cell.innerHTML =
            `<span class="db-pick-no">#${e.overall} · ${isCoach ? "🧠" : e.slot}</span>` +
            `<span class="db-name">${e.player.name}</span>` +
            `<span class="db-sub">${ovr}${salPart}</span>`;
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
    const slot = slots.includes(top.pos) ? top.pos : slots[0];

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

    game.managers.forEach((m) => {
      const filled = SCORING.starterPlayers({ starters: m.starters, bench: [] }).length;
      const card = el("div", "team-card" + (m.id === onClockId ? " on-clock" : ""));

      const head = el("div", "team-card-head");
      head.innerHTML =
        `<span class="team-name">${m.isCpu ? "🤖 " : ""}${m.name}</span>` +
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

    renderPodium(results);
    renderResultsDetail(results);
    showScreen("#results-screen");

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
    const wrap = $("#results-detail");
    wrap.innerHTML = "";
    results.forEach((r, i) => {
      const ev = r.eval;
      const m = r.manager;
      const team = el("div", "res-team");

      // Clean position-by-position roster (+ coach row when coaches are on).
      let rosterRows = STARTER_SLOTS.map((slot) => {
        const p = m.starters[slot];
        if (!p) return `<div class="res-slot empty"><span class="res-pos">${slot}</span><span class="res-pname">— empty —</span></div>`;
        return `<div class="res-slot">
            <span class="res-pos">${slot}</span>
            <span class="res-pname">${tierBadge(p)} ${p.name}</span>
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

      const maxWins = 73;
      const bars = ev.seasons
        .map((s, idx) => {
          const h = Math.round((s.wins / maxWins) * 100);
          return `<div class="bar" style="height:${h}%" data-tip="Yr ${idx + 1}: ${Math.round(s.wins)}-${Math.round(82 - s.wins)} · ${playoffLabel(s.playoffIndex)}"></div>`;
        })
        .join("");

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
        <div class="timeline">${bars}</div>`;
      wrap.appendChild(team);
    });
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
