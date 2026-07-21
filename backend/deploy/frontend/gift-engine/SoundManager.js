/* ============================================================
   gift-engine/SoundManager.js
   ------------------------------------------------------------
   Plays multiple gift sounds concurrently without cutting each
   other off, with fade in/out and a master volume control.

   ─────────────────────────────────────────────────────────────
   FIX (this pass) — THIS is the reason gift animations were not
   displaying at all, for every gift, on every send:

   This file used to do:
       import { AssetLoader } from "./AssetLoader.js";
   purely to load/cache <audio> elements. But AssetLoader.js also
   imports THREE.js AND ModelLoader.js (GLTFLoader/DRACOLoader)
   from a CDN — all leftovers from the OLD 3D/GLB gift engine
   that this 2D PNG-based engine (GiftAnimationManager.js) no
   longer uses.

   ES module imports are static and all-or-nothing: if that CDN
   import ever failed (ad-blocker, CSP, offline dev, network
   policy, slow connection, etc.), the failure propagated straight
   up the import chain:

       GiftAnimationManager.js
         -> SoundManager.js
           -> AssetLoader.js
             -> THREE.js (CDN) + ModelLoader.js (CDN)

   That made GiftAnimationManager.js fail to load AT ALL, so
   `new GiftAnimationManager(...)` in live.html never ran,
   `window.__giftEngine` was NEVER created, and every later call
   to `window.__giftEngine?.playGift(payload)` silently did
   nothing — no crash, no console error, because of the `?.`
   optional chaining swallowing the missing object. That's why
   nothing ever animated, for any gift, with zero visible symptoms.

   FIX: SoundManager now loads/caches its own <audio> elements
   directly. Zero dependency on AssetLoader / THREE / GLTFLoader /
   DRACOLoader. The entire 2D gift engine is now fully decoupled
   from the old 3D engine's import graph.
   ============================================================ */

const audioElementCache = new Map();

/**
 * Loads (and caches) a base <audio> element for a URL. Never
 * throws — resolves to null on failure so a missing/broken sound
 * file can never break gift playback.
 */
async function loadAudioElement(url) {

    if (!url)
        return null;

    if (audioElementCache.has(url))
        return audioElementCache.get(url);

    try {

        const audio = new Audio(url);

        audio.preload = "auto";

        await new Promise((resolve, reject) => {

            audio.addEventListener(
                "canplaythrough",
                resolve,
                { once: true }
            );

            audio.addEventListener(
                "error",
                reject,
                { once: true }
            );

            // Never block gift playback waiting on a slow/flaky
            // network — fall through and let it buffer in the
            // background while the gift animation still plays.
            setTimeout(resolve, 1500);

        });

        audioElementCache.set(url, audio);

        return audio;

    } catch (err) {

        console.warn(
            "[SoundManager] Audio failed to preload:",
            url,
            err
        );

        audioElementCache.set(url, null);

        return null;

    }

}

export class SoundManager {

    constructor({

        masterVolume = 0.7

    } = {}) {

        this.masterVolume = masterVolume;

        this.muted = false;

        this.activeNodes = new Set();

        this.audioPool = new Map();

    }

    setMasterVolume(volume) {

        this.masterVolume = Math.max(
            0,
            Math.min(1, volume)
        );

        this.activeNodes.forEach(node => {

            node.volume = Math.min(
                node.volume,
                this.masterVolume
            );

        });

    }

    setMuted(muted = true) {

        this.muted = muted;

        if (muted) {

            this.stopAll();

        }

    }

    async play(

        url,

        {

            volume = 1,
            fadeMs = 150,
            playbackRate = 1,
            loop = false

        } = {}

    ) {

        if (this.muted || !url)
            return null;

        const base = await loadAudioElement(url);

        if (!base)
            return null;

        const node = this._getNode(base);

        node.loop = loop;

        node.currentTime = 0;

        node.playbackRate = playbackRate;

        node.volume = 0;

        const targetVolume = Math.max(

            0,

            Math.min(

                1,

                volume * this.masterVolume

            )

        );

        this.activeNodes.add(node);

        try {

            await node.play();

        } catch {

            this.activeNodes.delete(node);

            return null;

        }

        this._fade(

            node,

            0,

            targetVolume,

            fadeMs

        );

        node.onended = () => {

            this.activeNodes.delete(node);

            this._returnNode(node);

        };

        return node;

    }

    fadeOutAndStop(

        node,

        fadeMs = 200

    ) {

        if (!node)
            return;

        this._fade(

            node,

            node.volume,

            0,

            fadeMs,

            () => {

                node.pause();

                node.currentTime = 0;

                this.activeNodes.delete(node);

                this._returnNode(node);

            }

        );

    }

    stopAll() {

        [...this.activeNodes].forEach(node => {

            this.fadeOutAndStop(

                node,

                120

            );

        });

    }

    dispose() {

        this.stopAll();

        this.audioPool.clear();

        this.activeNodes.clear();

    }

    _getNode(base) {

        const key = base.src;

        if (!this.audioPool.has(key)) {

            this.audioPool.set(key, []);

        }

        const pool = this.audioPool.get(key);

        if (pool.length) {

            return pool.pop();

        }

        return base.cloneNode();

    }

    _returnNode(node) {

        const key = node.src;

        if (!this.audioPool.has(key)) {

            this.audioPool.set(key, []);

        }

        this.audioPool

            .get(key)

            .push(node);

    }

    _fade(

        node,

        from,

        to,

        duration,

        done

    ) {

        if (!node)
            return;

        if (duration <= 0) {

            node.volume = to;

            done?.();

            return;

        }

        const start = performance.now();

        const animate = now => {

            const progress = Math.min(

                1,

                (now - start) / duration

            );

            node.volume =

                from +

                (to - from) *

                progress;

            if (progress < 1) {

                requestAnimationFrame(

                    animate

                );

            } else {

                node.volume = to;

                done?.();

            }

        };

        requestAnimationFrame(

            animate

        );

    }

}