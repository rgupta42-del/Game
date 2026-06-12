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
    staticBuilt: false,
    gameGen: 0, // generation counter so stale CPU timers can't fire into a new game
    pendingPlayer: null, // player awaiting slot assignment in the modal
  };

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
          ? "Each manager opens the link on their own device, makes their pick, then sends the updated link to the next manager. No CPUs."
          : "Everyone drafts on this device, taking turns. Tick 🤖 for CPU seats.";
      $("#start-draft").textContent = ui.mode === "online" ? "Start Online Draft" : "Start Draft";
      renderManagerNameInputs();
    });
  }

  // ---- Online state (share-a-link relay) ---------------------------------
  const b64urlEncode = (s) =>
    btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const b64urlDecode = (s) =>
    decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

  function encodeGameState() {
    const state = { n: game.managers.map((m) => m.name), p: game.pickLog.map((e) => [e.player.id, e.slot]) };
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
      game = new DraftGame(state.n, { benchSize: 0 }); // online = all human
      ui.online = true;
      ui.mode = "online";
      (state.p || []).forEach(([id, slot]) => {
        const p = PLAYER_POOL.find((x) => x.id === id);
        if (p) game.draft(p, slot);
      });
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

  function rebuildGameFrom(names, picks) {
    game = new DraftGame(names, { benchSize: 0 });
    (picks || []).forEach((pk) => {
      // pk may be an array [id, slot] or a Firebase object {0:id, 1:slot}.
      const p = PLAYER_POOL.find((x) => x.id === pk[0]);
      if (!p || game.isComplete) return;
      try {
        game.draft(p, pk[1]);
      } catch (e) {
        /* skip a malformed/duplicate pick rather than break the whole replay */
      }
    });
  }

  /** Host: create a live room, claim seat 0, start watching. */
  function startLiveDraft(names) {
    ui.online = true;
    ui.live = true;
    ui.roomId = randomRoomId();
    ui.mySeat = 0; // the host plays the first manager
    ui.gameGen++;
    localStorage.setItem(seatKey(ui.roomId), "0");
    rebuildGameFrom(names, []);
    buildDraftStaticUI();
    ui.staticBuilt = true;
    showScreen("#draft-screen");
    renderDraft();
    FBSync.create(ui.roomId, { names, picks: [], seats: { 0: names[0] || "Manager 1" } })
      .then(() => {
        history.replaceState(null, "", "#room=" + ui.roomId);
        FBSync.watch(ui.roomId, onRoomUpdate);
      })
      .catch((e) => {
        // Couldn't reach Firebase — degrade to the link-relay so the draft still works.
        console.error(e);
        ui.live = false;
        pushOnlineState();
        renderDraft();
      });
  }

  /** Joiner: open an existing live room and start watching. */
  function joinLiveRoom(roomId) {
    ui.online = true;
    ui.live = true;
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
    ui.gameGen++; // invalidate any pending timers
    rebuildGameFrom(names, picks);

    if (!ui.staticBuilt) {
      buildDraftStaticUI();
      ui.staticBuilt = true;
    }
    // First-time joiner picks which seat they are.
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
      const taken = takenIdx.has(i) && String(i) !== localStorage.getItem(seatKey(ui.roomId));
      const o = el("div", "so", `${nm}${taken ? " (taken)" : ""}`);
      if (taken) o.style.opacity = "0.5";
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

      // CPU seats only make sense in local mode.
      if (ui.mode !== "online") {
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
      }

      wrap.appendChild(row);
    }
  }

  function startDraft() {
    const rows = Array.from($("#manager-names").querySelectorAll(".mn-row"));
    const names = rows.map((r) => r.querySelector('input[type="text"]').value);
    const online = ui.mode === "online";
    const cpuFlags = online
      ? names.map(() => false)
      : rows.map((r) => {
          const cb = r.querySelector('input[type="checkbox"]');
          return cb ? cb.checked : false;
        });
    // Live online draft via Firebase when configured; otherwise link-relay.
    if (online && liveAvailable()) {
      startLiveDraft(names);
      return;
    }

    ui.online = online;
    ui.gameGen++;
    game = new DraftGame(names, { benchSize: 0, cpuFlags });
    initCpuProfiles();
    buildDraftStaticUI();
    ui.staticBuilt = true;
    showScreen("#draft-screen");
    if (online) pushOnlineState();
    renderDraft();
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
    ["ALL", ...STARTER_SLOTS].forEach((p) => {
      const chip = el("div", "pf" + (p === ui.posFilter ? " active" : ""), p);
      chip.addEventListener("click", () => {
        ui.posFilter = p;
        pf.querySelectorAll(".pf").forEach((c) => c.classList.toggle("active", c.textContent === p));
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

    // Hand the clock to the CPU if this seat is computer-controlled.
    scheduleCpuPick();
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
  const CPU_DELAY_MS = 850; // brief pause so picks are watchable

  function scheduleCpuPick() {
    const m = game.currentManager();
    if (!m || !m.isCpu) return;
    closeModal(); // a CPU never uses the manual slot picker
    const gen = ui.gameGen; // capture: ignore this timer if a new draft starts
    setTimeout(() => {
      if (gen !== ui.gameGen || !game || game.isComplete) return;
      const cur = game.currentManager();
      if (!cur || !cur.isCpu) return;
      const choice = cpuChoose(cur);
      if (choice) commitPick(choice.player, choice.slot);
    }, CPU_DELAY_MS);
  }

  /**
   * CPU draft strategy: take the best-fitting available player for the roster's
   * current needs, then slot them at their best legal position (preferring their
   * natural position, bench only as a last resort).
   */
  function cpuChoose(manager) {
    const avail = PLAYER_POOL.filter((p) => game.canDraft(manager, p));
    if (avail.length === 0) return null;

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

  function renderStatus() {
    const m = game.currentManager();
    $("#onclock-name").textContent = (m.isCpu ? "🤖 " : "") + m.name;
    $("#onclock-meta").textContent =
      `Round ${game.currentRound()} · Pick #${game.overallPickNumber()} of ${game.totalPicks}` +
      (m.isCpu ? " · CPU drafting…" : "");

    const up = $("#upcoming-list");
    up.innerHTML = "";
    game.upcoming(6).slice(1).forEach((p) => {
      up.appendChild(el("span", "up-chip", `#${p.overall} <b>${p.manager.name}</b>`));
    });

    const banner = $("#must-fill-banner");
    if (game.mustFillStarter(m)) {
      const slots = game.unfilledStarterSlots(m).join(", ");
      banner.textContent = `⚠️ ${m.name} must use remaining picks on starters — still need: ${slots}`;
      banner.classList.remove("hidden");
    } else {
      banner.classList.add("hidden");
    }
  }

  function visiblePlayers() {
    const m = game.currentManager();
    let list = PLAYER_POOL.filter((p) => game.isAvailable(p.id));

    if (ui.posFilter !== "ALL") {
      list = list.filter((p) => p.eligible.includes(ui.posFilter));
    }
    if (ui.search) {
      list = list.filter((p) => p.name.toLowerCase().includes(ui.search));
    }

    // For "fit" we decorate-sort-undecorate: compute bestFit once per player
    // (not twice per comparison). Other keys are cheap/memoized.
    if (ui.sortBy === "fit") {
      return list
        .map((p) => ({ p, k: bestFit(m, p) }))
        .sort((a, b) => b.k - a.k)
        .map((x) => x.p);
    }
    const sorters = {
      career: (a, b) => careerRating(b) - careerRating(a),
      peak: (a, b) => peakOverall(b) - peakOverall(a),
      winner: (a, b) => b.career.winning - a.career.winning,
      durable: (a, b) => a.injuryRisk - b.injuryRisk,
    };
    list.sort(sorters[ui.sortBy] || sorters.career);
    return list;
  }

  /** Best fit grade across the player's currently-legal slots for this manager. */
  function bestFit(manager, player) {
    const slots = game.legalSlotsFor(manager, player).filter((s) => s !== "BENCH");
    if (slots.length === 0) return pickFitGrade(manager, player, "BENCH");
    return Math.max(...slots.map((s) => pickFitGrade(manager, player, s)));
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
      const ovr = careerRating(p);
      const canDraft = !cpuOnClock && !locked && game.canDraft(m, p);
      const fit = Math.round(bestFit(m, p));

      const row = el("div", "player-row" + (canDraft ? "" : " disabled"));

      const photo = playerPhoto(p, ovr);

      const meta = el("div", "player-meta");
      meta.innerHTML = `
        <div class="pname">${tierBadge(p)} ${p.name} ${injuryDot(p.injuryRisk)}</div>
        <div class="psub">
          <span class="tag pos">${p.eligible.join("/")}</span>
          <span class="tag" title="Career-peak ability">Peak ${peakOverall(p)}</span>
          <span class="tag" title="Clutch shot-making">Clutch ${p.ext.clutch}</span>
          <span class="tag" title="Usage rate (ball dominance ${p.career.ballDominance})">${SCORING.usageTier(p)}</span>
          <span class="tag">${p.archetype}</span>
          ${ui.sortBy === "fit" || canDraft ? `<span class="tag fit">Fit ${fit}</span>` : ""}
        </div>`;

      const actions = el("div", "player-actions");
      if (canDraft) {
        const btn = el("button", "btn primary mini", "Draft");
        btn.onclick = () => onDraftClick(p);
        actions.appendChild(btn);
      } else if (cpuOnClock) {
        actions.appendChild(el("span", "slot-sub", "🤖 CPU"));
      } else if (locked) {
        actions.appendChild(el("span", "slot-sub", "⏳ waiting"));
      } else {
        actions.appendChild(el("span", "slot-sub", "No legal slot"));
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
      col.appendChild(el("div", "db-head", (m.isCpu ? "🤖 " : "") + m.name));
      for (let rd = 1; rd <= rounds; rd++) {
        const e = byMgrRound[m.id] && byMgrRound[m.id][rd];
        const isCurrent = m.id === curId && rd === curRound;
        const cell = el("div", "db-cell" + (e ? "" : " empty") + (isCurrent ? " current" : ""));
        if (e) {
          cell.innerHTML =
            `<span class="db-pick-no">#${e.overall} · ${e.slot}</span>` +
            `<span class="db-name">${e.player.name}</span>` +
            `<span class="db-sub">${careerRating(e.player)} ovr</span>`;
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
    const haveRow = strengthChips || `<span class="tn-chip">No picks yet</span>`;

    const openTxt = a.openPositions.length
      ? `<b>${a.openPositions.join(", ")}</b>`
      : "all five filled";

    const rec = recommendPick(m, a);
    const recHtml = rec ? `💡 <b>Target:</b> ${rec.text}` : "Your starting five is set.";

    wrap.innerHTML =
      `<div class="tn-title">${m.isCpu ? "🤖 " : ""}${m.name} — what your team has & needs</div>` +
      `<div class="tn-row">${haveRow}${gapChips}</div>` +
      `<div class="tn-open">Open positions: ${openTxt}</div>` +
      `<div class="tn-rec">${recHtml}</div>`;
  }

  /** Suggest the best complementary pick available for this roster. */
  function recommendPick(manager, analysis) {
    const avail = PLAYER_POOL.filter((p) => game.canDraft(manager, p));
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
      eval: evaluateRoster({ starters: m.starters, bench: m.bench }),
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

      // Clean position-by-position roster.
      const rosterRows = STARTER_SLOTS.map((slot) => {
        const p = m.starters[slot];
        if (!p) return `<div class="res-slot empty"><span class="res-pos">${slot}</span><span class="res-pname">— empty —</span></div>`;
        return `<div class="res-slot">
            <span class="res-pos">${slot}</span>
            <span class="res-pname">${tierBadge(p)} ${p.name}</span>
            <span class="res-ptag">${SCORING.usageTier(p)}</span>
            <span class="res-prate">${careerRating(p)}</span>
          </div>`;
      }).join("");

      // Strengths & weaknesses.
      const sw = SCORING.teamStrengthsWeaknesses({ starters: m.starters, bench: [] });
      const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
      const swList = (arr, cls, empty) =>
        arr.length
          ? arr.map((t) => `<li class="${cls}">${cap(t)}</li>`).join("")
          : `<li class="muted">${empty}</li>`;

      // Notable teammate pairings (roster construction).
      const syn = SCORING.synergyNotes({ starters: m.starters, bench: [] });
      const synHtml = syn.length
        ? `<div class="res-subhead">Chemistry &amp; notable pairings</div>
           <ul class="res-pairings">${syn.map((s) => `<li class="${s.kind}">${s.text}</li>`).join("")}</ul>`
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
