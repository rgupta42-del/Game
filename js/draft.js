/**
 * Snake-draft engine and game state for the NBA Re-Draft game.
 *
 * Draft order is a classic snake: managers pick 1..N in odd rounds and N..1 in
 * even rounds, so the manager who picks last also picks first in the next round.
 * Each manager must end with a full starting five (PG/SG/SF/PF/C) plus an
 * optional bench. Players carry "positional flexibility within reason" via their
 * `eligible` list.
 */

const STARTER_SLOTS = ["PG", "SG", "SF", "PF", "C"];

class DraftGame {
  /**
   * @param {string[]} managerNames
   * @param {object}  opts  { benchSize, cpuFlags }
   */
  constructor(managerNames, opts = {}) {
    this.benchSize = opts.benchSize ?? 2;
    this.picksPerManager = STARTER_SLOTS.length + this.benchSize;
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

  /** Starter positions a manager still needs to fill. */
  unfilledStarterSlots(manager) {
    return STARTER_SLOTS.filter((s) => !manager.starters[s]);
  }

  /**
   * If a manager's remaining picks exactly equal their unfilled starter slots,
   * every remaining pick MUST go toward filling a starter slot.
   */
  mustFillStarter(manager) {
    return this.picksRemainingFor(manager) <= this.unfilledStarterSlots(manager).length;
  }

  /** Is this player still on the board? */
  isAvailable(playerId) {
    return !this.draftedIds.has(playerId);
  }

  /**
   * The slots a manager could legally assign `player` to right now.
   * Returns an array of slot keys: starter position keys and/or "BENCH".
   */
  legalSlotsFor(manager, player) {
    const unfilled = this.unfilledStarterSlots(manager);
    const eligibleStarterSlots = player.eligible.filter(
      (pos) => STARTER_SLOTS.includes(pos) && !manager.starters[pos]
    );

    const slots = [...eligibleStarterSlots];

    // Bench is allowed only if the manager isn't forced to fill starters and
    // still has bench room.
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
   * legal slot is chosen automatically.
   * @returns {object} the pick log entry
   */
  draft(player, slot) {
    const manager = this.currentManager();
    if (!manager) throw new Error("Draft is already complete.");

    const legal = this.legalSlotsFor(manager, player);
    if (legal.length === 0) {
      throw new Error(`${manager.name} cannot draft ${player.name} right now.`);
    }
    const chosen = slot && legal.includes(slot) ? slot : legal[0];

    if (chosen === "BENCH") manager.bench.push(player);
    else manager.starters[chosen] = player;

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
