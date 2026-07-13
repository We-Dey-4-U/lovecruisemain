/* ============================================================
   gift-engine/SoundManager.js   [NEW FILE]
   Plays multiple gift sounds concurrently without cutting each
   other off, with fade in/out and a master volume control.
   ============================================================ */
/* ============================================================
   gift-engine/SoundManager.js
   High-performance audio manager with pooling, fading,
   overlapping playback and master controls.
   ============================================================ */

import { AssetLoader } from "./AssetLoader.js";

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

        const base = await AssetLoader.loadAudio(url);

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