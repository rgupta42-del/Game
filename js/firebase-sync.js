/**
 * Thin wrapper around Firebase Realtime Database for live online drafts.
 *
 * Exposes window.FBSync. If Firebase isn't configured (or the SDK failed to
 * load), FBSync.available() returns false and the app uses the link-relay
 * fallback instead. A draft "room" lives at drafts/{roomId} and holds:
 *   { names: [...], picks: [[playerId, slot], ...], seats: { idx: name } }
 */
(function () {
  "use strict";

  function configured() {
    const c = window.FIREBASE_CONFIG;
    return !!(
      typeof firebase !== "undefined" &&
      c &&
      c.databaseURL &&
      !/PASTE_/.test(JSON.stringify(c))
    );
  }

  const FBSync = {
    available() {
      return configured();
    },

    _init() {
      if (this._db) return true;
      if (!configured()) return false;
      try {
        this._app =
          firebase.apps && firebase.apps.length
            ? firebase.app()
            : firebase.initializeApp(window.FIREBASE_CONFIG);
        this._db = firebase.database();
        return true;
      } catch (e) {
        console.error("Firebase init failed:", e);
        return false;
      }
    },

    _ref(roomId) {
      return this._db.ref("drafts/" + roomId);
    },

    /** Create a new room with initial state. Returns a promise. */
    create(roomId, state) {
      if (!this._init()) return Promise.reject(new Error("Firebase unavailable"));
      return this._ref(roomId).set(state);
    },

    /** Subscribe to all changes in a room. cb receives the room object (or null). */
    watch(roomId, cb) {
      if (!this._init()) return;
      this._ref(roomId).on("value", (snap) => cb(snap.val()));
    },

    /** Stop listening to a room. */
    unwatch(roomId) {
      if (this._db) this._ref(roomId).off();
    },

    /** Overwrite the room's picks array (only the on-clock manager writes). */
    writePicks(roomId, picks) {
      if (!this._init()) return Promise.reject(new Error("Firebase unavailable"));
      return this._ref(roomId).child("picks").set(picks);
    },

    /**
     * Atomically append one pick IFF the picks list is still `expectedLen` long.
     * Lets any present client safely cover a CPU pick when the host is away —
     * the transaction guarantees only one append commits (no double-picks).
     * Returns a promise resolving to true if THIS client committed the pick.
     */
    appendPickIf(roomId, expectedLen, pick) {
      if (!this._init()) return Promise.resolve(false);
      const ref = this._ref(roomId).child("picks");
      return ref
        .transaction((cur) => {
          const arr = cur == null ? [] : Array.isArray(cur) ? cur.slice() : Object.values(cur);
          if (arr.length !== expectedLen) return; // abort: someone already picked
          arr.push(pick);
          return arr;
        })
        .then((res) => !!(res && res.committed))
        .catch(() => false);
    },

    /** Record that a seat has been claimed by a named player. */
    claimSeat(roomId, seatIndex, name) {
      if (!this._init()) return Promise.resolve();
      return this._ref(roomId).child("seats/" + seatIndex).set(name);
    },

    /** Broadcast a quick emoji reaction: [seatIndex, emoji, clientTs]. */
    react(roomId, seatIndex, emoji) {
      if (!this._init()) return Promise.resolve();
      return this._ref(roomId).child("reactions").push([seatIndex, emoji, Date.now()]);
    },

    // ---- Live auctions -----------------------------------------------------
    /** Put a player on the block: { pid, bid, leaderId, ts }. */
    setAuction(roomId, auction) {
      if (!this._init()) return Promise.resolve();
      return this._ref(roomId).child("auction").set(auction);
    },
    /** Atomically raise the bid (only if this lot is still live and higher). */
    bidAuction(roomId, pid, amount, mgrId) {
      if (!this._init()) return Promise.resolve(false);
      return this._ref(roomId)
        .child("auction")
        .transaction((cur) => {
          if (!cur || cur.pid !== pid) return; // abort: lot changed/closed
          if (!(amount > cur.bid) || cur.leaderId === mgrId) return; // abort
          return { pid: cur.pid, bid: amount, leaderId: mgrId, ts: Date.now() };
        })
        .then((res) => !!(res && res.committed))
        .catch(() => false);
    },
    /** Close the lot (after the winning pick has been committed). */
    clearAuction(roomId) {
      if (!this._init()) return Promise.resolve();
      return this._ref(roomId).child("auction").remove();
    },
  };

  window.FBSync = FBSync;
})();
