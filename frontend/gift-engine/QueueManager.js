/* ============================================================
   gift-engine/QueueManager.js   [NEW FILE]
   - Basic gifts: fire-and-forget, many at once (no queueing).
   - Premium/legendary gifts: strict FIFO queue, one cinematic
     plays at a time, sorted by priority, so a 100x-simultaneous
     gift storm never overlaps/clashes (req #5).
   ============================================================ */

export class QueueManager {
  constructor({ onPlayPremium, onPlayBasic, maxQueueLength = 40 }) {
    this.onPlayPremium = onPlayPremium;
    this.onPlayBasic = onPlayBasic;
    this.maxQueueLength = maxQueueLength;
    this.queue = [];
    this.playing = false;
  }

  push(item) {
    if (item.tierInfo.allowOverlap) {
      // basic gift -> play immediately, never blocks the queue
      this.onPlayBasic(item);
      return;
    }

    this.queue.push(item);
    this.queue.sort((a, b) => b.tierInfo.priority - a.tierInfo.priority);

    // Under extreme load, drop the lowest-priority overflow rather than
    // let the queue grow unbounded (req #5: prevent frame drops).
    if (this.queue.length > this.maxQueueLength) {
      this.queue.length = this.maxQueueLength;
    }

    this._tryPlayNext();
  }

  async _tryPlayNext() {
    if (this.playing || this.queue.length === 0) return;
    this.playing = true;
    const item = this.queue.shift();
    try {
      await this.onPlayPremium(item);
    } catch (err) {
      console.error("[QueueManager] premium animation failed, continuing:", err);
    } finally {
      this.playing = false;
      this._tryPlayNext();
    }
  }

  get pending() {
    return this.queue.length;
  }
}