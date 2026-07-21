/* ============================================================
   gift-engine/QueueManager.js   [NEW FILE]
   - Basic gifts: fire-and-forget, many at once (no queueing).
   - Premium/legendary gifts: strict FIFO queue, one cinematic
     plays at a time, sorted by priority, so a 100x-simultaneous
     gift storm never overlaps/clashes (req #5).
   ============================================================ */

/* ============================================================
   gift-engine/QueueManager.js
   Updated Version
   ------------------------------------------------------------
   - Priority queue
   - Combo support
   - Queue cancellation
   - Pause / Resume
   - Flush queue
   - Queue events
   - Safe error handling
   ============================================================ */

export class QueueManager {

    constructor({

        onPlayPremium,
        onPlayBasic,
        onQueueStart,
        onQueueEnd,
        onQueueChanged,

        maxQueueLength = 40

    }) {

        this.onPlayPremium = onPlayPremium;
        this.onPlayBasic = onPlayBasic;

        this.onQueueStart = onQueueStart;
        this.onQueueEnd = onQueueEnd;
        this.onQueueChanged = onQueueChanged;

        this.maxQueueLength = maxQueueLength;

        this.queue = [];

        this.playing = false;
        this.paused = false;

        this.comboMap = new Map();
    }

    push(item) {

        if (!item)
            return;

        // ----------------------------------------------------
        // Basic Gifts
        // ----------------------------------------------------

        if (item.tierInfo.allowOverlap) {

            this._trackCombo(item);

            try {

                this.onPlayBasic?.(item);

            } catch (err) {

                console.error(err);

            }

            return;

        }

        // ----------------------------------------------------
        // Premium Queue
        // ----------------------------------------------------

        this.queue.push(item);

        this.queue.sort((a, b) => {

            if (b.tierInfo.priority !== a.tierInfo.priority)
                return b.tierInfo.priority - a.tierInfo.priority;

            return (a.timestamp || Date.now()) - (b.timestamp || Date.now());

        });

        if (this.queue.length > this.maxQueueLength) {

            this.queue.length = this.maxQueueLength;

        }

        this.onQueueChanged?.(this.queue.length);

        this._tryPlayNext();

    }

    async _tryPlayNext() {

        if (this.paused)
            return;

        if (this.playing)
            return;

        if (!this.queue.length) {

            this.onQueueEnd?.();

            return;

        }

        this.playing = true;

        this.onQueueStart?.();

        const item = this.queue.shift();

        this.onQueueChanged?.(this.queue.length);

        try {

            await this.onPlayPremium?.(item);

        } catch (err) {

            console.error("[QueueManager]", err);

        }

        finally {

            this.playing = false;

            this._tryPlayNext();

        }

    }

    _trackCombo(item) {

        const key =
            `${item.senderId || item.sender}-${item.receiverId || item.receiver}-${item.giftName}`;

        const combo = this.comboMap.get(key) || {

            count: 0,
            timer: null

        };

        combo.count++;

        clearTimeout(combo.timer);

        combo.timer = setTimeout(() => {

            this.comboMap.delete(key);

        }, 3000);

        this.comboMap.set(key, combo);

        item.comboCount = combo.count;

    }

    pause() {

        this.paused = true;

    }

    resume() {

        this.paused = false;

        this._tryPlayNext();

    }

    clear() {

        this.queue.length = 0;

        this.onQueueChanged?.(0);

    }

    cancel(filterFn) {

        this.queue = this.queue.filter(item => !filterFn(item));

        this.onQueueChanged?.(this.queue.length);

    }

    get pending() {

        return this.queue.length;

    }

    get isBusy() {

        return this.playing;

    }

}