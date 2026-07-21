/* ============================================================
   gift-engine/ComboManager.js
   ------------------------------------------------------------
   Detects rapid repeated gifts from the same sender+gift and
   merges them into a live combo counter (2x/5x/10x/20x/50x/100x)
   instead of re-playing the full cinematic on every single send.

   ─────────────────────────────────────────────────────────────
   FIX (this pass): the previous version deferred the FIRST play
   of every premium/legendary gift until the 1.5s combo window
   closed — and every additional send inside that window RESET
   the timer. If gifts arrived faster than the window, the
   animation never played at all. That's the bug behind
   "gift animations aren't showing."

   Correct behavior (matches TikTok/Chatta/Bigo):
     - First gift of a type   -> plays IMMEDIATELY (onImmediatePlay)
     - Repeats inside window  -> bump the on-screen "xN" counter
                                  (onComboUpdated), don't replay
     - Window closes          -> onComboFinalized fires once, for
                                  analytics/leaderboard, no replay
                                  needed since the visual already
                                  played on receipt #1.
   ============================================================ */

const COMBO_WINDOW_MS = 1500;

export const COMBO_STEPS = [
    2,
    5,
    10,
    20,
    50,
    100
];

export class ComboManager {

    constructor() {

        this.active = new Map();

        this.highestCombo = 0;

    }

    _key(item) {

        return `${item.senderId || item.sender}:${item.giftKey}`;

    }

    /**
     * @param {object} item - the gift item being registered
     * @param {function} onImmediatePlay - called ONCE, synchronously,
     *        the first time this sender+gift combo is seen. This is
     *        what should actually trigger the animation.
     * @param {function} [onComboUpdated] - called on every repeat
     *        inside the combo window, for updating the "xN" HUD.
     * @param {function} [onComboFinalized] - called once the combo
     *        window closes with no further repeats. Use this for
     *        analytics/leaderboard totals, NOT for replaying the
     *        animation (it already played via onImmediatePlay).
     */
    register(
        item,
        onImmediatePlay,
        onComboUpdated,
        onComboFinalized
    ) {

        const key = this._key(item);

        const existing = this.active.get(key);

        if (existing) {

            existing.count += item.quantity || 1;

            existing.lastItem = item;

            existing.updatedAt = Date.now();

            clearTimeout(existing.timer);

            this.highestCombo = Math.max(
                this.highestCombo,
                existing.count
            );

            onComboUpdated?.({

                ...existing.lastItem,

                comboCount: existing.count,

                comboStep: ComboManager.nearestStep(existing.count),

                progress: ComboManager.progress(existing.count)

            });

            existing.timer = setTimeout(() => {

                this.active.delete(key);

                onComboFinalized?.({

                    ...existing.lastItem,

                    comboCount: existing.count,

                    comboStep: ComboManager.nearestStep(existing.count)

                });

            }, COMBO_WINDOW_MS);

            return {

                type: "merged",

                count: existing.count,

                step: ComboManager.nearestStep(existing.count)

            };

        }

        const entry = {

            count: item.quantity || 1,

            lastItem: item,

            createdAt: Date.now(),

            updatedAt: Date.now(),

            timer: null

        };

        entry.timer = setTimeout(() => {

            this.active.delete(key);

            onComboFinalized?.({

                ...entry.lastItem,

                comboCount: entry.count,

                comboStep: ComboManager.nearestStep(entry.count)

            });

        }, COMBO_WINDOW_MS);

        this.active.set(key, entry);

        this.highestCombo = Math.max(
            this.highestCombo,
            entry.count
        );

        // ── THE FIX ──────────────────────────────────────────
        // Play right now. Don't wait for the combo window to
        // close — that's what was starving every premium/
        // legendary gift's animation.
        onImmediatePlay?.(item);

        return {

            type: "new",

            item,

            count: entry.count,

            step: ComboManager.nearestStep(entry.count)

        };

    }

    clear() {

        this.active.forEach(entry => {

            clearTimeout(entry.timer);

        });

        this.active.clear();

    }

    resetSender(senderId) {

        for (const [key, value] of this.active.entries()) {

            if (key.startsWith(`${senderId}:`)) {

                clearTimeout(value.timer);

                this.active.delete(key);

            }

        }

    }

    getActiveCombos() {

        return [...this.active.values()].map(entry => ({

            count: entry.count,

            item: entry.lastItem

        }));

    }

    get size() {

        return this.active.size;

    }

    static nearestStep(count) {

        let result = 0;

        for (const step of COMBO_STEPS) {

            if (count >= step) {

                result = step;

            }

        }

        return result || count;

    }

    static progress(count) {

        let previous = 0;

        let next = COMBO_STEPS[COMBO_STEPS.length - 1];

        for (const step of COMBO_STEPS) {

            if (count < step) {

                next = step;

                break;

            }

            previous = step;

        }

        if (count >= next)
            return 1;

        return (count - previous) / (next - previous);

    }

    dispose() {

        this.clear();

    }

}