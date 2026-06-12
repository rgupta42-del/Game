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

    /** Record that a seat has been claimed by a named player. */
    claimSeat(roomId, seatIndex, name) {
      if (!this._init()) return Promise.resolve();
      return this._ref(roomId).child("seats/" + seatIndex).set(name);
    },
  };

  window.FBSync = FBSync;
})();
