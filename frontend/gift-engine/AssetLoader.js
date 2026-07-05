/* ============================================================
   gift-engine/AssetLoader.js   [NEW FILE]
   Lazy-loads + caches audio assets. Never throws past the caller —
   failures resolve to null so the stream never crashes (req #13).
   ============================================================ */

const audioCache = new Map();

export const AssetLoader = {
  async loadAudio(url) {
    if (!url) return null;
    if (audioCache.has(url)) return audioCache.get(url);

    try {
      const audio = new Audio(url);
      audio.preload = "auto";
      await new Promise((resolve, reject) => {
        audio.addEventListener("canplaythrough", resolve, { once: true });
        audio.addEventListener("error", reject, { once: true });
        // safety timeout so a slow/missing asset never blocks the queue
        setTimeout(resolve, 1500);
      });
      audioCache.set(url, audio);
      return audio;
    } catch (err) {
      console.warn("[AssetLoader] audio failed to load, continuing without sound:", url, err);
      audioCache.set(url, null);
      return null;
    }
  },

  preload(urls = []) {
    urls.filter(Boolean).forEach((u) => this.loadAudio(u));
  },
};