/* ============================================================
   gift-engine/SoundManager.js   [NEW FILE]
   Plays multiple gift sounds concurrently without cutting each
   other off, with fade in/out and a master volume control.
   ============================================================ */
import { AssetLoader } from "./AssetLoader.js";

export class SoundManager {
  constructor({ masterVolume = 0.7 } = {}) {
    this.masterVolume = masterVolume;
    this.activeNodes = new Set();
    this.muted = false;
  }

  setMasterVolume(v) {
    this.masterVolume = Math.max(0, Math.min(1, v));
  }

  setMuted(muted) {
    this.muted = muted;
  }

  async play(url, { volume = 1, fadeMs = 150 } = {}) {
    if (this.muted || !url) return;
    const base = await AssetLoader.loadAudio(url);
    if (!base) return; // missing asset -> silently skip, never crash

    // clone so overlapping plays of the same sound don't cut each other off
    const node = base.cloneNode();
    node.volume = 0;
    const target = Math.max(0, Math.min(1, volume * this.masterVolume));
    this.activeNodes.add(node);

    node.play().catch(() => {});
    this._fade(node, 0, target, fadeMs);

    node.addEventListener("ended", () => {
      this.activeNodes.delete(node);
    });
  }

  fadeOutAndStop(node, fadeMs = 200) {
    this._fade(node, node.volume, 0, fadeMs, () => {
      node.pause();
      this.activeNodes.delete(node);
    });
  }

  _fade(node, from, to, ms, onDone) {
    const steps = 10;
    const stepMs = ms / steps;
    let i = 0;
    node.volume = from;
    const id = setInterval(() => {
      i++;
      node.volume = from + (to - from) * (i / steps);
      if (i >= steps) {
        clearInterval(id);
        node.volume = to;
        onDone && onDone();
      }
    }, stepMs);
  }

  stopAll() {
    this.activeNodes.forEach((n) => this.fadeOutAndStop(n, 120));
  }
}