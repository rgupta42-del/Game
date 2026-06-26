/**
 * Snake-draft engine and game state for the NBA Re-Draft game.
 *
 * Draft order is a classic snake: managers pick 1..N in odd rounds and N..1 in
 * even rounds, so the manager who picks last also picks first in the next round.
 * Each manager must end with a full starting five (PG/SG/SF/PF/C) plus an
 * optional bench. Players carry "positional flexibility within reason" via their
 * `eligible` list.
 *
 * Two position rules are supported:
 *   • LOCKED   — each pick is assigned to a specific open starting slot.
 *   • FLEXIBLE — a player can be drafted as long as the whole starting five can
 *                still be arranged legally (a bipartite matching of every drafted
 *                player to a distinct slot they're eligible for). Existing picks
 *                may shuffle slots to make room (PG→SF, SF→PF, etc.).
 *
 * An optional COACH round (last round) lets each manager draft one head coach.
 */

const STARTER_SLOTS = ["PG", "SG", "SF", "PF", "C"];

class DraftGame {
  /**
   * @param {string[]} managerNames
   * @param {object}  opts  { benchSize, cpuFlags, posMode, coachMode }
   */
  constructor(managerNames, opts = {}) {
    this.benchSize = opts.benchSize ?? 2;
    this.posMode = opts.posMode === "flexible" ? "flexible" : "locked";
    this.coachMode = !!opts.coachMode;
    this.picksPerManager = STARTER_SLOTS.length + this.benchSize + (this.coachMode ? 1 : 0);
    const cpuFlags = opts.cpuFlags ?? [];

    this.managers = managerNames.map((name, i) => {
      const isCpu = !!cpuFlags[i];
      const trimmed = name && name.trim();
      return {
        id: i,
        name: trimmed ? trimmed : isCpu ? `CPU ${i + 1}` : `Manager ${i + 1}`,
        isCpu,
        starters: { PG: null, SG: null, SF: null, PF: null, C: null },
        bench: [],
        coach: null,
      };
    });

    this.draftedIds = new Set();
    this.pickLog = []; // { managerId, player, slot, round, overall }
    this.order = this._buildOrder();
    this.currentPick = 0; // index into this.order
  }

  /** Build the full snake order as a flat array of manager indices. */
  _buildOrder() {
    const order = [];
    const n = this.managers.length;
    for (let round = 0; round < this.picksPerManager; round++) {
      const seq = [...Array(n).keys()];
      if (round % 2 === 1) seq.reverse();
      order.push(...seq);
    }
    return order;
  }

  get totalPicks() {
    return this.order.length;
  }

  get isComplete() {
    return this.currentPick >= this.totalPicks;
  }

  /** Manager whose turn it is (or null if the draft is over). */
  currentManager() {
    if (this.isComplete) return null;
    return this.managers[this.order[this.currentPick]];
  }

  currentRound() {
    return Math.floor(this.currentPick / this.managers.length) + 1;
  }

  /** The (1-indexed) round in which coaches are drafted, or -1 if no coach mode. */
  get coachRoundNumber() {
    return this.coachMode ? this.picksPerManager : -1;
  }

  /** Is the draft currently in the coach round? */
  isCoachRound() {
    return this.coachMode && !this.isComplete && this.currentRound() === this.coachRoundNumber;
  }

  /** Overall pick number, 1-indexed. */
  overallPickNumber() {
    return this.currentPick + 1;
  }

  /** How many picks this manager has remaining (including the current one). */
  picksRemainingFor(manager) {
    let count = 0;
    for (let i = this.currentPick; i < this.order.length; i++) {
      if (this.order[i] === manager.id) count++;
    }
    return count;
  }

  /** Remaining picks for a manager that must go to STARTER slots (excludes the
   *  coach round). */
  _starterPicksRemaining(manager) {
    let count = 0;
    for (let i = this.currentPick; i < this.order.length; i++) {
      if (this.order[i] !== manager.id) continue;
      const round = Math.floor(i / this.managers.length) + 1;
      if (this.coachMode && round === this.coachRoundNumber) continue;
      count++;
    }
    return count;
  }

  /** Starter positions a manager still needs to fill. */
  unfilledStarterSlots(manager) {
    return STARTER_SLOTS.filter((s) => !manager.starters[s]);
  }

  /** Players currently assigned to a starting slot. */
  _starterList(manager) {
    return STARTER_SLOTS.map((s) => manager.starters[s]).filter(Boolean);
  }

  /**
   * If a manager's remaining (starter) picks exactly equal their unfilled starter
   * slots, every remaining pick MUST go toward filling a starter slot.
   */
  mustFillStarter(manager) {
    return this._starterPicksRemaining(manager) <= this.unfilledStarterSlots(manager).length;
  }

  /** Is this player still on the board? */
  isAvailable(playerId) {
    return !this.draftedIds.has(playerId);
  }

  /**
   * Bipartite matching (Kuhn's algorithm): assign every player in `players` to a
   * distinct starting slot they're eligible for. `pin` optionally forces one
   * player into one slot. Returns a { slot: player } map covering all players, or
   * null if no such complete assignment exists.
   */
  _match(players, pin) {
    const slotTo = {}; // slot -> player
    const locked = new Set();
    let pool = players.slice().sort((a, b) => a.eligible.length - b.eligible.length);
    if (pin) {
      slotTo[pin.slot] = pin.player;
      locked.add(pin.slot);
      pool = pool.filter((p) => p !== pin.player);
    }
    const tryAssign = (p, seen) => {
      for (const s of p.eligible) {
        if (!STARTER_SLOTS.includes(s) || locked.has(s) || seen.has(s)) continue;
        seen.add(s);
        if (slotTo[s] === undefined || tryAssign(slotTo[s], seen)) {
          slotTo[s] = p;
          return true;
        }
      }
      return false;
    };
    for (const p of pool) {
      if (!tryAssign(p, new Set())) return null;
    }
    return slotTo;
  }

  /** (Flexible mode) the slots a player could occupy in SOME legal full lineup. */
  _flexibleSlots(manager, player) {
    if (!this.isAvailable(player.id)) return [];
    const current = this._starterList(manager);
    if (current.length >= STARTER_SLOTS.length) return [];
    const players = current.concat(player);
    const out = [];
    for (const s of player.eligible) {
      if (!STARTER_SLOTS.includes(s)) continue;
      if (this._match(players, { player, slot: s })) out.push(s);
    }
    return out;
  }

  /**
   * The slots a manager could legally assign `player` to right now.
   * Returns an array of slot keys: starter position keys, "BENCH", or "COACH".
   */
  legalSlotsFor(manager, player) {
    // Coach round: only coaches, into the single coach slot.
    if (this.isCoachRound()) {
      return player && player.isCoach && !manager.coach ? ["COACH"] : [];
    }
    if (player && player.isCoach) return []; // coaches only draftable in the coach round

    if (this.posMode === "flexible") {
      return this._flexibleSlots(manager, player);
    }

    // Locked mode (classic): fill a specific open, eligible slot.
    const eligibleStarterSlots = player.eligible.filter(
      (pos) => STARTER_SLOTS.includes(pos) && !manager.starters[pos]
    );
    const slots = [...eligibleStarterSlots];

    const benchHasRoom = manager.bench.length < this.benchSize;
    if (benchHasRoom && !this.mustFillStarter(manager)) {
      slots.push("BENCH");
    }
    return slots;
  }

  /** Can this manager draft this player at all right now? */
  canDraft(manager, player) {
    if (!this.isAvailable(player.id)) return false;
    return this.legalSlotsFor(manager, player).length > 0;
  }

  /**
   * Execute a pick. `slot` must be one of legalSlotsFor(); if omitted, the first
   * legal slot is chosen automatically. In flexible mode `slot` is treated as a
   * preferred slot and the rest of the lineup may shuffle to accommodate it.
   * @returns {object} the pick log entry
   */
  draft(player, slot) {
    const manager = this.currentManager();
    if (!manager) throw new Error("Draft is already complete.");

    // --- Coach round ---
    if (this.isCoachRound()) {
      if (!player.isCoach || manager.coach) {
        throw new Error(`${manager.name} must draft a head coach right now.`);
      }
      manager.coach = player;
      return this._record(manager, player, "COACH");
    }
    if (player.isCoach) throw new Error("Coaches are drafted in the final round.");

    // --- Flexible positions ---
    if (this.posMode === "flexible") {
      return this._draftFlexible(manager, player, slot);
    }

    // --- Locked positions (classic) ---
    const legal = this.legalSlotsFor(manager, player);
    if (legal.length === 0) {
      throw new Error(`${manager.name} cannot draft ${player.name} right now.`);
    }
    const chosen = slot && legal.includes(slot) ? slot : legal[0];
    if (chosen === "BENCH") manager.bench.push(player);
    else manager.starters[chosen] = player;
    return this._record(manager, player, chosen);
  }

  /** Flexible draft: place `player`, reshuffling existing starters as needed. */
  _draftFlexible(manager, player, preferSlot) {
    if (!this.isAvailable(player.id)) {
      throw new Error(`${player.name} is no longer available.`);
    }
    const current = this._starterList(manager);
    if (current.length >= STARTER_SLOTS.length) {
      throw new Error(`${manager.name}'s starting five is already full.`);
    }

    // If the preferred slot is open and legal, take it directly — no reshuffle.
    // This keeps online replay deterministic: encoded picks carry each player's
    // FINAL slot, and replaying in draft order places everyone back exactly.
    const preferOk =
      preferSlot && STARTER_SLOTS.includes(preferSlot) && player.eligible.includes(preferSlot);
    if (preferOk && !manager.starters[preferSlot]) {
      manager.starters[preferSlot] = player;
      return this._record(manager, player, preferSlot);
    }

    // Otherwise find a full legal arrangement (pinning the preferred slot if any),
    // which may shuffle existing starters (PG→SF, SF→PF, …) to make room.
    const players = current.concat(player);
    let slotTo = preferOk ? this._match(players, { player, slot: preferSlot }) : null;
    if (!slotTo) slotTo = this._match(players, null);
    if (!slotTo) {
      throw new Error(`${manager.name} can't fit ${player.name} into a legal lineup.`);
    }
    for (const s of STARTER_SLOTS) manager.starters[s] = slotTo[s] || null;

    const entry = this._record(manager, player, STARTER_SLOTS.find((s) => manager.starters[s] === player));
    // Earlier picks may have shifted slots — keep their log entries in sync so the
    // encoded draft (and the draft board) reflect the current arrangement.
    this.pickLog.forEach((e) => {
      if (e.managerId === manager.id && e.slot !== "COACH") {
        const cur = STARTER_SLOTS.find((s) => manager.starters[s] === e.player);
        if (cur) e.slot = cur;
      }
    });
    return entry;
  }

  /** Commit a pick to the log + advance the clock. */
  _record(manager, player, chosen) {
    this.draftedIds.add(player.id);
    const entry = {
      managerId: manager.id,
      managerName: manager.name,
      player,
      slot: chosen,
      round: this.currentRound(),
      overall: this.overallPickNumber(),
    };
    this.pickLog.push(entry);
    this.currentPick++;
    return entry;
  }

  /** Upcoming pick order preview (next `count` picks). */
  upcoming(count = 6) {
    const out = [];
    for (let i = this.currentPick; i < this.order.length && out.length < count; i++) {
      out.push({
        overall: i + 1,
        round: Math.floor(i / this.managers.length) + 1,
        manager: this.managers[this.order[i]],
      });
    }
    return out;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { DraftGame, STARTER_SLOTS };
}
if (typeof window !== "undefined") {
  window.DraftGame = DraftGame;
  window.STARTER_SLOTS = STARTER_SLOTS;
}
