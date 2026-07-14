/* ============================================================
   gift-engine/GiftAnimationManager.js
   ------------------------------------------------------------
   REWRITE: PNG-based 2D engine (replaces the old Three.js/GLB
   engine). Public API is UNCHANGED, so live.html/podcast-live.html
   don't need any edits — same import path, same constructor call:

     import { GiftAnimationManager } from "./gift-engine/GiftAnimationManager.js";
     const giftEngine = new GiftAnimationManager(document.getElementById("gift-engine-root"));
     giftEngine.playGift(payload); // payload = whatever giftReceived already sends

   payload fields used (all optional/defensive):
     { name, senderId, avatar, giftName, giftEmoji, giftIcon, amount, quantity }

   `giftIcon` (gifts.icon_url, forwarded by giftController.send())
   is what actually gets animated — the viewer sees the EXACT PNG
   from the gift catalog fly/spin/pulse/drive across the screen,
   not a substitute 3D shape. If giftIcon is missing/fails to load,
   it falls back to giftEmoji automatically (see GiftSpriteAnimator.js).

   Still reused UNCHANGED from the old engine (both are generic,
   never touched Three.js): ComboManager.js, QueueManager.js,
   SoundManager.js, UIOverlay.js.
   ============================================================ */

import { SoundManager } from "./SoundManager.js";
import { UIOverlay } from "./UIOverlay.js";
import { ComboManager, COMBO_STEPS } from "./ComboManager.js";
import { QueueManager } from "./QueueManager.js";
import { ParticleLayer2D } from "./ParticleLayer2D.js";
import { playSprite } from "./GiftSpriteAnimator.js";
import { resolveGiftAnim } from "./giftAnimConfig.js";

export class GiftAnimationManager {

    constructor(rootEl, { maxBasicConcurrent = 14 } = {}) {

        if (!rootEl) {
            throw new Error("GiftAnimationManager requires a root element");
        }

        this.rootEl = rootEl;
        this.rootEl.style.cssText = `
            position:fixed;
            inset:0;
            pointer-events:none;
            z-index:15;
            overflow:hidden;
        `;

        this.reducedMotion =
            window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        this.particles = new ParticleLayer2D(rootEl);
        this.sound = new SoundManager();
        this.ui = new UIOverlay(rootEl);
        this.combo = new ComboManager();

        this.basicActiveCount = 0;
        this.maxBasicConcurrent = maxBasicConcurrent;
        this.totalAnimationsPlayed = 0;

        this.queue = new QueueManager({

            onPlayPremium: item => this._playFeatured(item),
            onPlayBasic: item => this._playBasic(item),

            onQueueStart: () => { this.queueRunning = true; },
            onQueueEnd: () => { this.queueRunning = false; },

        });

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

            const cfg = resolveGiftAnim(giftName);

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
                    giftName,

                // The actual PNG to animate — server-authoritative,
                // sourced from gifts.icon_url via giftController.send().
                giftIcon:
                    payload.giftIcon ||
                    payload.iconUrl ||
                    payload.icon_url ||
                    null,

                giftEmoji:
                    payload.giftEmoji || "🎁",

                quantity:
                    payload.quantity || 1,

                amount:
                    payload.amount || 0,

                timestamp:
                    Date.now(),

                cfg,

                tierInfo:
                    cfg.tierInfo,

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
       BASIC GIFT ANIMATION (overlapping, e.g. Rose/Heart/Like/Kiss)
       ======================================================== */

    async _playBasic(item) {

        if (this.basicActiveCount >= this.maxBasicConcurrent)
            return;

        this.basicActiveCount++;
        this.totalAnimationsPlayed++;

        if (item.cfg.sound) {

            this.sound.play(item.cfg.sound, {

                volume: 0.6,

                fadeMs: 80

            });

        }

        const duration = this.reducedMotion
            ? 500
            : item.tierInfo.durationMs;

        try {

            await playSprite({

                rootEl: this.rootEl,
                particles: this.particles,

                iconUrl: item.giftIcon,
                emoji: item.giftEmoji,

                animation: this.reducedMotion ? "popGlow" : item.cfg.animation,
                color: item.cfg.color,
                particlePreset: item.cfg.particle,

                durationMs: duration,
                sizePx: 72,
                basic: true,

            });

        } finally {

            this.basicActiveCount--;

        }

    }

    /* ========================================================
       PREMIUM / LEGENDARY CINEMATIC (queued, one at a time)
       ======================================================== */

    async _playFeatured(item) {

        this.totalAnimationsPlayed++;

        const comboCount =
            item.comboCount ||
            item.quantity ||
            1;

        const duration = this.reducedMotion
            ? 1200
            : item.tierInfo.durationMs;

        // Slightly bigger sprite the higher the combo, capped.
        const sizePx = Math.min(
            260,
            140 + Math.min(comboCount, 100) * 0.6
        );

        this.ui.focusDim(true);

        this.ui.showBanner({

            sender: item.sender,
            receiver: item.receiver,
            giftTitle: item.giftTitle,

        });

        if (comboCount >= COMBO_STEPS[0]) {

            this.ui.showCombo(comboCount);

        }

        if (item.cfg.sound) {

            this.sound.play(item.cfg.sound, {

                volume:
                    item.tierInfo.priority >= 10
                        ? 1
                        : 0.85

            });

        }

        await playSprite({

            rootEl: this.rootEl,
            particles: this.particles,

            iconUrl: item.giftIcon,
            emoji: item.giftEmoji,

            animation: this.reducedMotion ? "popGlow" : item.cfg.animation,
            color: item.cfg.color,
            particlePreset: item.cfg.particle,

            durationMs: duration,
            sizePx,
            basic: false,

        });

        this.ui.focusDim(false);

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
       RENDERER (canvas resize passthrough)
       ======================================================== */

    resize() {

        this.particles?.resize();

    }

    /* ========================================================
       QUEUE / STOP
       ======================================================== */

    stopAll() {

        this.sound.stopAll();
        this.queue.clear();
        this.particles?.clear();
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
            this.particles?.dispose();
            this.ui?.destroy();

        } catch (err) {

            console.warn(
                "[GiftAnimationManager] destroy:",
                err
            );

        }

    }

}