/* ============================================================
   gift-engine/GiftAnimationManager.js   [NEW FILE]
   ------------------------------------------------------------
   PUBLIC API — this is the ONLY thing live.js imports/calls.
   It does not touch sockets, wallet, or DB logic — it only
   reacts to gift payloads handed to it.

     import { GiftAnimationManager } from "./gift-engine/GiftAnimationManager.js";
     const giftEngine = new GiftAnimationManager(document.getElementById("gift-engine-root"));
     giftEngine.playGift(payload); // payload = whatever giftReceived already sends

   payload fields used (all optional/defensive):
     { name, senderId, avatar, giftName, giftEmoji, amount }
   ============================================================ */
/* ============================================================
   gift-engine/GiftAnimationManager.js
   PART 1

   FIX (this pass): `_playBasic` previously called
   `GiftFactory.buildMesh()` (an async function) WITHOUT
   awaiting it, then immediately called `.position.set(...)` on
   the returned Promise object. Every basic-tier gift (Rose,
   Heart, Clap, Bouquet, Cake, Kiss) would throw here in
   production. `_playBasic` is now async and properly awaits
   the mesh. Basic gifts now also play their sound via
   SoundManager, matching the original spec (previously only
   premium/legendary gifts played sound).
   ============================================================ */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

import { ThreeRenderer } from "./ThreeRenderer.js";
import { GiftFactory } from "./GiftFactory.js";
import { SoundManager } from "./SoundManager.js";
import { UIOverlay } from "./UIOverlay.js";
import { QueueManager } from "./QueueManager.js";
import { ComboManager, COMBO_STEPS } from "./ComboManager.js";
import { resolveGiftConfig, GIFT_REGISTRY } from "./giftConfig.js";

export class GiftAnimationManager {

    constructor(
        rootEl,
        {
            maxBasicConcurrent = 12,
            preloadAssets = true
        } = {}
    ) {

        if (!rootEl) {

            throw new Error(
                "GiftAnimationManager requires a root element"
            );

        }

        this.rootEl = rootEl;

        this.reducedMotion =
            window.matchMedia(
                "(prefers-reduced-motion: reduce)"
            ).matches;

        try {

            this.renderer = new ThreeRenderer(rootEl);

        } catch (err) {

            console.error(
                "[GiftAnimationManager] WebGL init failed:",
                err
            );

            this.renderer = null;

        }

        this.sound = new SoundManager();

        this.ui = new UIOverlay(rootEl);

        this.combo = new ComboManager();

        this.basicActiveCount = 0;

        this.maxBasicConcurrent = maxBasicConcurrent;

        this.totalAnimationsPlayed = 0;

        this.queue = new QueueManager({

            onPlayPremium: item =>
                this._playPremium(item),

            onPlayBasic: item =>
                this._playBasic(item),

            onQueueStart: () => {

                this.queueRunning = true;

            },

            onQueueEnd: () => {

                this.queueRunning = false;

            }

        });

        if (preloadAssets) {

            try {

                GiftFactory.preload(
                    Object.values(GIFT_REGISTRY)
                );

            } catch (err) {

                console.warn(
                    "[GiftAnimationManager] preload failed",
                    err
                );

            }

        }

    }

    /* ========================================================
       PUBLIC API
       ======================================================== */

    playGift(payload = {}) {

        try {

            const giftName =
                payload.giftName ||
                payload.name ||
                payload.gift?.name ||
                "Gift";

            const cfg =
                resolveGiftConfig(giftName);

            const item = {

                sender:
                    payload.senderName ||
                    payload.name ||
                    "Someone",

                senderId:
                    payload.senderId ||
                    payload.sender_id,

                receiver:
                    payload.receiverName ||
                    payload.receiver ||
                    "Host",

                receiverId:
                    payload.receiverId ||
                    payload.receiver_id,

                avatar:
                    payload.avatar,

                giftKey:
                    giftName.toLowerCase(),

                giftTitle:
                    cfg.label,

                quantity:
                    payload.quantity || 1,

                amount:
                    payload.amount || 0,

                timestamp:
                    Date.now(),

                cfg,

                tierInfo:
                    cfg.tierInfo

            };

            if (item.tierInfo.allowOverlap) {

                this.queue.push(item);

                return;

            }

            const comboResult =
                this.combo.register(
                    item,
                    finalized => {

                        this.queue.push({

                            ...finalized,

                            isComboFinal: true

                        });

                    }
                );

            if (
                comboResult &&
                comboResult.type === "merged"
            ) {

                this.ui.showCombo(
                    comboResult.count
                );

            }

        } catch (err) {

            console.error(
                "[GiftAnimationManager] playGift error:",
                err
            );

        }

    }

    playMany(gifts = []) {

        if (!Array.isArray(gifts))
            return;

        gifts.forEach(gift => {

            this.playGift(gift);

        });

    }

    clearQueue() {

        this.queue.clear();

    }

    pauseQueue() {

        this.queue.pause();

    }

    resumeQueue() {

        this.queue.resume();

    }

    get pendingQueue() {

        return this.queue.pending;

    }

    get isBusy() {

        return this.queue.isBusy;

    }

    /* ========================================================
       BASIC GIFT ANIMATION
       ======================================================== */

    async _playBasic(item) {

        if (!this.renderer)
            return;

        if (this.basicActiveCount >= this.maxBasicConcurrent)
            return;

        this.basicActiveCount++;

        this.totalAnimationsPlayed++;

        let mesh;

        try {

            // FIX: buildMesh is async — must be awaited, otherwise
            // `mesh` is a pending Promise and every call below
            // (mesh.position, mesh.rotation, mesh.scale...) throws.
            mesh = await GiftFactory.buildMesh(item.cfg);

        } catch (err) {

            console.warn(
                "[GiftAnimationManager] basic buildMesh failed:",
                err
            );

            mesh = null;

        }

        if (!mesh) {

            this.basicActiveCount--;

            return;

        }

        mesh.position.set(
            (Math.random() - 0.5) * 4,
            -2.8,
            (Math.random() - 0.5) * 1
        );

        mesh.rotation.set(
            Math.random(),
            Math.random(),
            Math.random()
        );

        this.renderer.addObject(mesh);

        this.renderer.particles.burst({

            origin: [
                mesh.position.x,
                mesh.position.y,
                mesh.position.z
            ],

            count: 24,

            color: item.cfg.color,

            spread: 1.4,

            speed: 1.6

        });

        // Basic gifts now play sound too (fire-and-forget, cloned/
        // pooled by SoundManager so many overlapping roses etc.
        // don't cut each other off).
        if (item.cfg.sound) {

            this.sound.play(item.cfg.sound, {

                volume: 0.6,

                fadeMs: 80

            });

        }

        const duration = this.reducedMotion
            ? 500
            : item.tierInfo.durationMs;

        const start = performance.now();

        const animate = (time) => {

            const progress = Math.min(
                1,
                (time - start) / duration
            );

            mesh.position.y =
                -2.8 + progress * 5.5;

            mesh.rotation.x += 0.04;
            mesh.rotation.y += 0.06;
            mesh.rotation.z += 0.02;

            mesh.scale.setScalar(

                0.6 +
                Math.sin(progress * Math.PI) * 0.15

            );

            if (mesh.material) {

                mesh.material.transparent = true;

                mesh.material.opacity = 1 - progress;

            }

            if (progress < 1) {

                requestAnimationFrame(animate);

            } else {

                this.renderer.removeObject(mesh);

                this.basicActiveCount--;

            }

        };

        requestAnimationFrame(animate);

    }

    /* ========================================================
       PREMIUM / LEGENDARY CINEMATIC
       ======================================================== */

    async _playPremium(item) {

        if (!this.renderer)
            return;

        this.totalAnimationsPlayed++;

        const cfg = item.cfg;

        const comboCount =
            item.comboCount ||
            item.quantity ||
            1;

        const duration = this.reducedMotion
            ? 1200
            : item.tierInfo.durationMs;

        this.ui.focusDim(true);

        if (!this.reducedMotion) {

            await this.renderer.panCameraTo(
                0.6,
                0.25,
                5.2,
                700
            );

        }

        const mesh = await GiftFactory.buildMesh(cfg);

        if (!mesh) {

            this.ui.focusDim(false);

            return;

        }

        mesh.scale.multiplyScalar(

            1 +
            Math.min(comboCount, 100) / 100

        );

        mesh.position.set(0, -3, 0);

        this.renderer.addObject(mesh);

        const glow = new THREE.PointLight(

            cfg.color,

            item.tierInfo.priority >= 10
                ? 6
                : 4,

            10

        );

        glow.position.set(0, 0, 1);

        this.renderer.scene.add(glow);

        this.ui.showBanner({

            sender: item.sender,

            receiver: item.receiver,

            giftTitle: cfg.label

        });

        if (comboCount >= COMBO_STEPS[0]) {

            this.ui.showCombo(comboCount);

        }

        this.sound.play(cfg.sound, {

            volume:
                item.tierInfo.priority >= 10
                    ? 1
                    : 0.85

        });

        this.renderer.particles.burst({

            origin: [0,0,0],

            count:
                item.tierInfo.priority >= 10
                    ? 220
                    : 120,

            color: cfg.color,

            spread:
                item.tierInfo.priority >= 10
                    ? 3
                    : 2,

            speed: 2.2

        });

        if (item.tierInfo.priority >= 10) {

            this.renderer.particles.shockwave(
                [0,0,0],
                cfg.color
            );

        }

        await new Promise(resolve => {

            const start = performance.now();

            const animate = (time) => {

                const progress = Math.min(
                    1,
                    (time - start) / duration
                );

                mesh.position.y =
                    -3 + Math.min(progress * 2,1) * 3;

                mesh.rotation.y += 0.025;
                mesh.rotation.x += 0.01;

                mesh.scale.setScalar(

                    (1 +
                    Math.sin(progress * Math.PI) * 0.2) *

                    (1 +
                    Math.min(comboCount,100)/100)

                );

                glow.intensity =
                    (item.tierInfo.priority >=10 ? 6 : 4)
                    * (1-progress);

                if(progress > .7 && mesh.material){

                    mesh.material.transparent = true;

                    mesh.material.opacity =
                        1 -
                        ((progress-.7)/.3);

                }

                if(progress < 1){

                    requestAnimationFrame(animate);

                }else{

                    resolve();

                }

            };

            requestAnimationFrame(animate);

        });

        this.renderer.removeObject(mesh);

        this.renderer.scene.remove(glow);

        this.ui.focusDim(false);

        if (!this.reducedMotion) {

            await this.renderer.resetCamera(500);

        }

    }

    /* ========================================================
       AUDIO
       ======================================================== */

    setMuted(muted = true) {

        this.sound.setMuted(muted);

    }

    setMasterVolume(volume = 1) {

        this.sound.setMasterVolume(volume);

    }

    /* ========================================================
       RENDERER
       ======================================================== */

    resize() {

        this.renderer?._resize();

    }

    /* ========================================================
       QUEUE
       ======================================================== */

    stopAll() {

        this.sound.stopAll();

        this.queue.clear();

        this.renderer?.particles.clear();

        this.ui.focusDim(false);

    }

    /* ========================================================
       STATS
       ======================================================== */

    getStats() {

        return {

            totalAnimationsPlayed: this.totalAnimationsPlayed,

            activeBasicAnimations: this.basicActiveCount,

            pendingQueue: this.queue.pending,

            queueBusy: this.queue.isBusy,

            reducedMotion: this.reducedMotion

        };

    }

    /* ========================================================
       DESTROY
       ======================================================== */

    destroy() {

        try {

            this.stopAll();

            this.renderer?.dispose();

            this.ui?.destroy();

        } catch (err) {

            console.warn(
                "[GiftAnimationManager] destroy:",
                err
            );

        }

    }

}