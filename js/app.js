/**
 * UI controller for the NBA Re-Draft game.
 * Ties together the player pool, the snake-draft engine and the analytics
 * engine, and renders the setup / draft / results screens.
 */

(function () {
  "use strict";

  const { careerRating, peakOverall, pickFitGrade, evaluateRoster, playoffLabel } = SCORING;

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
  }

  function renderManagerNameInputs() {
    const n = parseInt($("#num-managers").value, 10);
    const wrap = $("#manager-names");
    // Preserve any values/CPU toggles already entered across re-renders.
    const prevName = {};
    const prevCpu = {};
    wrap.querySelectorAll(".mn-row").forEach((row, i) => {
      prevName[i] = row.querySelector('input[type="text"]').value;
      prevCpu[i] = row.querySelector('input[type="checkbox"]').checked;
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

  function startDraft() {
    const rows = Array.from($("#manager-names").querySelectorAll(".mn-row"));
    const names = rows.map((r) => r.querySelector('input[type="text"]').value);
    const cpuFlags = rows.map((r) => r.querySelector('input[type="checkbox"]').checked);
    game = new DraftGame(names, { benchSize: 0, cpuFlags });
    buildDraftStaticUI();
    showScreen("#draft-screen");
    renderDraft();
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
    $("#search").oninput = (e) => {
      ui.search = e.target.value.toLowerCase();
      renderPlayerList();
    };
    $("#sort-by").value = ui.sortBy;
    $("#sort-by").onchange = (e) => {
      ui.sortBy = e.target.value;
      renderPlayerList();
    };

    $("#slot-cancel").onclick = closeModal;
  }

  function renderDraft() {
    if (game.isComplete) {
      showResults();
      return;
    }
    renderStatus();
    renderDraftBoard();
    renderTeamNeeds();
    renderPlayerList();
    renderAllRosters();

    // Hand the clock to the CPU if this seat is computer-controlled.
    scheduleCpuPick();
  }

  // ---- CPU autodraft -----------------------------------------------------
  const CPU_DELAY_MS = 850; // brief pause so picks are watchable

  function scheduleCpuPick() {
    const m = game.currentManager();
    if (!m || !m.isCpu) return;
    closeModal(); // a CPU never uses the manual slot picker
    ui.cpuThinking = true;
    setTimeout(() => {
      // Re-check: state may have changed (e.g. a New Draft) while we waited.
      if (!game || game.isComplete) return;
      const cur = game.currentManager();
      if (!cur || !cur.isCpu) return;
      const choice = cpuChoose(cur);
      ui.cpuThinking = false;
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

    let best = null;
    let bestGrade = -Infinity;
    for (const p of avail) {
      const grade = bestFit(manager, p);
      if (grade > bestGrade) {
        bestGrade = grade;
        best = p;
      }
    }

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

    const sorters = {
      career: (a, b) => careerRating(b) - careerRating(a),
      fit: (a, b) => bestFit(m, b) - bestFit(m, a),
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
    const list = $("#player-list");
    list.innerHTML = "";
    const players = visiblePlayers();

    if (players.length === 0) {
      list.appendChild(el("p", "muted", "No available players match your filters."));
      return;
    }

    players.forEach((p) => {
      const ovr = careerRating(p);
      const canDraft = !cpuOnClock && game.canDraft(m, p);
      const fit = Math.round(bestFit(m, p));

      const row = el("div", "player-row" + (canDraft ? "" : " disabled"));

      const badge = el("div", "ovr-badge", String(ovr));
      badge.title = "Career rating";
      badge.style.borderColor = ovrColor(ovr);

      const meta = el("div", "player-meta");
      meta.innerHTML = `
        <div class="pname">${p.name} ${injuryDot(p.injuryRisk)}</div>
        <div class="psub">
          <span class="tag pos">${p.eligible.join("/")}</span>
          <span class="tag" title="Career-peak ability">Peak ${peakOverall(p)}</span>
          <span class="tag" title="Winning / playoff pedigree">Win ${p.career.winning}</span>
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
      } else {
        actions.appendChild(el("span", "slot-sub", "No legal slot"));
      }

      row.appendChild(badge);
      row.appendChild(meta);
      row.appendChild(actions);
      list.appendChild(row);
    });
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
    $("#play-again").onclick = () => location.reload();
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
        <div class="podium-record">${playoffLabel(r.eval.avgPlayoffIndex)} · ${r.eval.titlesExpected.toFixed(2)} titles</div>
        <div class="podium-score">${Math.round(r.eval.composite)}</div>`;
      wrap.appendChild(card);
    });
  }

  function renderResultsDetail(results) {
    const wrap = $("#results-detail");
    wrap.innerHTML = "";
    results.forEach((r, i) => {
      const ev = r.eval;
      const team = el("div", "res-team");

      const roster = SCORING.starterPlayers({ starters: r.manager.starters, bench: r.manager.bench });
      const benchNames = r.manager.bench.filter(Boolean).map((p) => p.name);

      const maxWins = 73;
      const bars = ev.seasons
        .map((s, idx) => {
          const h = Math.round((s.wins / maxWins) * 100);
          return `<div class="bar" style="height:${h}%" data-tip="Yr ${idx + 1}: ${Math.round(s.wins)}-${Math.round(82 - s.wins)} · ${playoffLabel(s.playoffIndex)}"></div>`;
        })
        .join("");

      team.innerHTML = `
        <h4>${i === 0 ? "🏆 " : ""}${r.manager.name}</h4>
        <div class="res-stats">
          <div class="res-stat"><b>${ev.avgRecord}</b>Avg season record</div>
          <div class="res-stat"><b>${ev.peakWins}</b>Peak wins</div>
          <div class="res-stat"><b>${ev.titlesExpected.toFixed(2)}</b>Expected titles (15 yr)</div>
          <div class="res-stat"><b>${Math.round(ev.composite)}</b>Composite score</div>
        </div>
        <ul class="res-notes">${ev.breakdown.map((n) => `<li>${n}</li>`).join("")}</ul>
        <div class="res-roster"><b>Starters:</b> ${roster.map((p) => `${p.name} (${p.pos})`).join(", ")}${
        benchNames.length ? ` · <b>Bench:</b> ${benchNames.join(", ")}` : ""
      }</div>
        <div class="timeline">${bars}</div>`;
      wrap.appendChild(team);
    });
  }

  // ---- Boot --------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", initSetup);
})();
