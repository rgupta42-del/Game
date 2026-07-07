/**
 * Arcade sound effects for the NBA Re-Draft game — 100% synthesized with
 * WebAudio (no audio files, nothing to license, nothing to download).
 *
 * window.SFX.play(name) — fire-and-forget; silently no-ops when muted, when
 * WebAudio is unavailable (old browsers, headless tests), or before the first
 * user gesture (autoplay policy). SFX.toggle() flips the persisted mute.
 */
(function () {
  "use strict";

  let ctx = null;
  let muted = false;
  try {
    muted = localStorage.getItem("nbaredraft_muted") === "1";
  } catch (e) {}

  function ac() {
    const AC = (typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext)) || null;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function env(node, t0, dur, vol) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(g);
    g.connect(ctx.destination);
  }

  function tone(freq, dur, type, vol, when, slide) {
    const c = ac();
    if (!c) return;
    const t0 = c.currentTime + (when || 0);
    const o = c.createOscillator();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    env(o, t0, dur, vol || 0.15);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function noise(dur, vol, when) {
    const c = ac();
    if (!c) return;
    const t0 = c.currentTime + (when || 0);
    const buf = c.createBuffer(1, Math.max(1, (c.sampleRate * dur) | 0), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    env(src, t0, dur, vol || 0.2);
    src.start(t0);
  }

  const FX = {
    pick() { tone(660, 0.09, "triangle", 0.16); tone(880, 0.13, "triangle", 0.13, 0.07); },
    yourturn() { tone(523, 0.12, "sine", 0.2); tone(784, 0.2, "sine", 0.2, 0.12); },
    tick() { tone(1250, 0.03, "square", 0.05); },
    buzzer() { tone(185, 0.65, "sawtooth", 0.22); tone(139, 0.65, "sawtooth", 0.16); },
    bid() { tone(880, 0.06, "square", 0.1); },
    sold() { noise(0.08, 0.3); tone(988, 0.22, "triangle", 0.18, 0.06); },
    champion() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.4, "triangle", 0.18, i * 0.14));
      noise(0.5, 0.05, 0.62);
    },
  };

  window.SFX = {
    play(name) {
      if (muted) return;
      try { if (FX[name]) FX[name](); } catch (e) {}
    },
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem("nbaredraft_muted", muted ? "1" : "0"); } catch (e) {}
      return muted;
    },
    /** Call on the first user gesture so the AudioContext is allowed to run. */
    unlock() { try { ac(); } catch (e) {} },
  };
})();
