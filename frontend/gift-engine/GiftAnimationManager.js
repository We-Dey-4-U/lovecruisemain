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
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { ThreeRenderer } from "./ThreeRenderer.js";
import { GiftFactory } from "./GiftFactory.js";
import { SoundManager } from "./SoundManager.js";
import { UIOverlay } from "./UIOverlay.js";
import { QueueManager } from "./QueueManager.js";
import { ComboManager, COMBO_STEPS } from "./ComboManager.js";
import { resolveGiftConfig } from "./giftConfig.js";

export class GiftAnimationManager {
  constructor(rootEl, { maxBasicConcurrent = 12 } = {}) {
    if (!rootEl) throw new Error("GiftAnimationManager requires a root container element");
    this.rootEl = rootEl;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    try {
      this.renderer = new ThreeRenderer(rootEl);
    } catch (err) {
      console.error("[GiftAnimationManager] WebGL init failed — gifts will be silently skipped, livestream unaffected:", err);
      this.renderer = null;
    }

    this.sound = new SoundManager();
    this.ui = new UIOverlay(rootEl);
    this.combo = new ComboManager();
    this.basicActiveCount = 0;
    this.maxBasicConcurrent = maxBasicConcurrent;

    this.queue = new QueueManager({
      onPlayPremium: (item) => this._playPremium(item),
      onPlayBasic: (item) => this._playBasic(item),
    });
  }

  /**
   * Call this from the existing `socket.on("giftReceived", ...)` handler.
   * Safe to call as often as needed — never throws.
   */
  playGift(payload) {
    try {
      const giftName = payload.giftName || payload.gift?.name || "Gift";
      const cfg = resolveGiftConfig(giftName);
      const item = {
        sender: payload.name || payload.senderName || "Someone",
        senderId: payload.senderId || payload.sender_id,
        receiver: payload.receiverName || "Host",
        giftKey: giftName.toLowerCase(),
        giftTitle: cfg.label,
        quantity: payload.quantity || 1,
        cfg,
        tierInfo: cfg.tierInfo,
      };

      if (item.tierInfo.allowOverlap) {
        this.queue.push(item);
        return;
      }

      // premium/legendary: merge rapid repeats into a combo instead of
      // re-triggering the full cinematic each time
      const result = this.combo.register(item, (finalized) => {
        this.queue.push({ ...finalized, isComboFinal: true });
      });
      if (result.type === "merged") {
        this.ui.showCombo(result.count);
      }
    } catch (err) {
      // requirement #13: never crash the livestream on a bad/asset-missing gift
      console.error("[GiftAnimationManager] playGift failed, continuing stream:", err);
    }
  }

  _playBasic(item) {
    if (!this.renderer) return;
    if (this.basicActiveCount >= this.maxBasicConcurrent) return; // graceful degrade under load
    this.basicActiveCount++;

    const mesh = GiftFactory.buildMesh(item.cfg);
    mesh.position.set((Math.random() - 0.5) * 3, -2.5, 0);
    this.renderer.addObject(mesh);
    this.renderer.particles.burst({ origin: [mesh.position.x, -1, 0], count: 16, color: item.cfg.color, spread: 1.2 });

    const start = performance.now();
    const duration = this.reducedMotion ? 500 : item.tierInfo.durationMs;
    const animate = (t) => {
      const p = Math.min(1, (t - start) / duration);
      mesh.position.y = -2.5 + p * 5;
      mesh.rotation.y += 0.06;
      mesh.material.opacity = 1 - p;
      mesh.material.transparent = true;
      if (p < 1) {
        requestAnimationFrame(animate);
      } else {
        this.renderer.removeObject(mesh);
        this.basicActiveCount--;
      }
    };
    requestAnimationFrame(animate);
  }

  async _playPremium(item) {
    if (!this.renderer) return;
    const cfg = item.cfg;
    const duration = this.reducedMotion ? 1200 : item.tierInfo.durationMs;
    const comboCount = item.comboCount || item.quantity || 1;

    // 1-2: assets are already resolved via cfg (sound preloaded lazily)
    // 3: dim background, focus near "recipient" (center of viewport)
    this.ui.focusDim(true);
    if (!this.reducedMotion) {
      await this.renderer.panCameraTo(0.6, 0.3, 5.2, 700);
    }

    // 5: build + drop in the 3D mesh with glow/bloom-like emissive material
    const mesh = GiftFactory.buildMesh(cfg);
    const scaleBoost = item.tierInfo.priority >= 10 ? 1.25 : 1;
    mesh.scale.multiplyScalar(scaleBoost * (1 + Math.min(comboCount, 100) / 100));
    mesh.position.set(0, -3, 0);
    this.renderer.addObject(mesh);

    const glow = new THREE.PointLight(cfg.color, 4, 8);
    glow.position.set(0, 0, 1);
    this.renderer.scene.add(glow);

    // 6-8: sender / receiver / gift name
    this.ui.showBanner({ sender: item.sender, receiver: item.receiver, giftTitle: cfg.label }, Math.min(duration, 3000));
    if (comboCount >= COMBO_STEPS[0]) {
      this.ui.showCombo(comboCount);
    }

    // 9: synchronized sound
    this.sound.play(cfg.sound, { volume: item.tierInfo.priority >= 10 ? 1 : 0.85 });

    this.renderer.particles.burst({
      origin: [0, 0, 0],
      count: item.tierInfo.priority >= 10 ? 160 : 80,
      color: cfg.color,
      spread: item.tierInfo.priority >= 10 ? 2.6 : 1.8,
    });

    await new Promise((resolve) => {
      const start = performance.now();
      const animate = (t) => {
        const p = Math.min(1, (t - start) / duration);
        mesh.position.y = -3 + Math.min(1, p * 2.2) * 3;
        mesh.rotation.y += 0.02;
        mesh.rotation.x = Math.sin(p * Math.PI * 2) * 0.1;
        glow.intensity = 4 * (1 - p);
        if (p > 0.7) {
          mesh.material.transparent = true;
          mesh.material.opacity = 1 - (p - 0.7) / 0.3;
        }
        if (p < 1) {
          requestAnimationFrame(animate);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(animate);
    });

    // 10: cleanup
    this.renderer.removeObject(mesh);
    this.renderer.scene.remove(glow);
    this.ui.focusDim(false);
    if (!this.reducedMotion) await this.renderer.resetCamera(500);
  }

  setMuted(muted) {
    this.sound.setMuted(muted);
  }

  destroy() {
    this.renderer?.dispose();
  }
}