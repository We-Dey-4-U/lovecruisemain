/* ============================================================
   gift-engine/ComboManager.js   [NEW FILE]
   Detects rapid repeated gifts from the same sender+gift and
   merges them into a combo (2x/5x/10x/20x/50x/100x) instead of
   re-playing the full cinematic each time (req #6).
   ============================================================ */

const COMBO_WINDOW_MS = 1500;
export const COMBO_STEPS = [2, 5, 10, 20, 50, 100];

export class ComboManager {
  constructor() {
    // key -> { count, timer, lastItem }
    this.active = new Map();
  }

  _key(item) {
    return `${item.senderId || item.sender}:${item.giftKey}`;
  }

  /**
   * Feed a new gift event in. Returns either:
   *  - { type: "merged", count }              -> caller updates the combo badge, no new animation
   *  - { type: "new", item }                   -> caller should enqueue a fresh animation
   */
  register(item, onComboFinalized) {
    const key = this._key(item);
    const existing = this.active.get(key);

    if (existing) {
      existing.count += item.quantity || 1;
      existing.lastItem = item;
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => {
        this.active.delete(key);
        onComboFinalized && onComboFinalized({ ...existing.lastItem, comboCount: existing.count });
      }, COMBO_WINDOW_MS);
      return { type: "merged", count: existing.count };
    }

    const entry = {
      count: item.quantity || 1,
      lastItem: item,
      timer: setTimeout(() => {
        this.active.delete(key);
        onComboFinalized && onComboFinalized({ ...item, comboCount: entry.count });
      }, COMBO_WINDOW_MS),
    };
    this.active.set(key, entry);
    return { type: "new", item };
  }

  static nearestStep(count) {
    let result = COMBO_STEPS[0];
    for (const step of COMBO_STEPS) {
      if (count >= step) result = step;
    }
    return count >= COMBO_STEPS[0] ? result : count;
  }
}