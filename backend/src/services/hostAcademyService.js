/* ============================================================
   backend/src/services/hostAcademyService.js   [NEW — Part 3]
   ============================================================ */

const db = require("../config/db");
const AntiFraudService = require("./antiFraudService");

const GOLDEN_LOVE_DAILY_TARGET = 5;
const MIN_DISTINCT_SENDERS = 3;
const TASKS_REQUIRED_PER_DAY = 3;
const QUALIFICATION_DAYS = 7;

const VALID_TASKS = new Set([
  "active_30m",
  "new_followers_2",
  "profile_likes_5",
  "profile_visits_10",
  "chat_messages_10",
  "new_verified_match",
  "daily_checkin",
]);

function today() {
  return new Date().toISOString().slice(0, 10); // UTC date, adjust to your app's TZ policy
}

const HostAcademyService = {
  /**
   * Called from giftService.sendGift() right after a successful,
   * non-refunded gift where gift.is_golden_love = true.
   * Not part of the gift's DB transaction on purpose — qualification
   * is best-effort/eventually-consistent and must never roll back
   * a coin transfer that already succeeded.
   */
  async recordGoldenLoveGift(io, { giftTransactionId, senderId, receiverId }) {
    if (senderId === receiverId) return; // belt-and-braces, giftService already blocks this

    const eligible = await AntiFraudService.isEligibleForQualification({
      giftTransactionId,
      senderId,
    });
    if (!eligible) return;

    const date = today();
    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO host_academy_daily_log (user_id, log_date)
         VALUES ($1, $2) ON CONFLICT (user_id, log_date) DO NOTHING`,
        [receiverId, date]
      );

      const { rows } = await client.query(
        `UPDATE host_academy_daily_log
         SET golden_love_count = golden_love_count + 1,
             golden_love_senders = CASE
               WHEN $3 = ANY(golden_love_senders) THEN golden_love_senders
               ELSE array_append(golden_love_senders, $3)
             END,
             updated_at = NOW()
         WHERE user_id = $1 AND log_date = $2
         RETURNING golden_love_count, golden_love_senders, tasks_completed, day_completed`,
        [receiverId, date, senderId]
      );

      await this._maybeCompleteDay(client, receiverId, date, rows[0]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[hostAcademyService.recordGoldenLoveGift] error:", err);
      return;
    } finally {
      client.release();
    }

    await this._pushProgress(io, receiverId);
  },

  /**
   * Called from wherever the underlying event happens: follow
   * handlers, chat handlers, matching, profile view tracking, or a
   * simple POST /host-academy/checkin route for daily_checkin.
   */
  async recordTask(io, { userId, taskKey }) {
    if (!VALID_TASKS.has(taskKey)) return;
    const date = today();

    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO host_academy_daily_log (user_id, log_date)
         VALUES ($1, $2) ON CONFLICT (user_id, log_date) DO NOTHING`,
        [userId, date]
      );

      const { rows } = await client.query(
        `UPDATE host_academy_daily_log
         SET tasks_completed = CASE
               WHEN $3 = ANY(tasks_completed) THEN tasks_completed
               ELSE array_append(tasks_completed, $3)
             END,
             updated_at = NOW()
         WHERE user_id = $1 AND log_date = $2
         RETURNING golden_love_count, golden_love_senders, tasks_completed, day_completed`,
        [userId, date, taskKey]
      );

      await this._maybeCompleteDay(client, userId, date, rows[0]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[hostAcademyService.recordTask] error:", err);
      return;
    } finally {
      client.release();
    }

    await this._pushProgress(io, userId);
  },

  /**
   * Internal: checks whether today's log now satisfies both the
   * Golden Love + 3-of-7-tasks requirement, and if so marks the day
   * complete and advances the user's streak. Must run inside the
   * caller's transaction (`client`) so the day-completed flag and
   * the streak update are atomic with each other.
   */
  async _maybeCompleteDay(client, userId, date, log) {
    if (!log || log.day_completed) return;

    const goldenLoveOk =
      log.golden_love_count >= GOLDEN_LOVE_DAILY_TARGET &&
      log.golden_love_senders.length >= MIN_DISTINCT_SENDERS;
    const tasksOk = log.tasks_completed.length >= TASKS_REQUIRED_PER_DAY;

    if (!goldenLoveOk || !tasksOk) return;

    await client.query(
      `UPDATE host_academy_daily_log SET day_completed = TRUE, updated_at = NOW()
       WHERE user_id = $1 AND log_date = $2`,
      [userId, date]
    );

    await client.query(
      `INSERT INTO host_academy_progress (user_id, current_day, consecutive_days_completed, last_qualifying_date)
       VALUES ($1, 1, 0, NULL)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    const { rows: progRows } = await client.query(
      `SELECT * FROM host_academy_progress WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    const prog = progRows[0];

    const yesterday = new Date(date);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const isConsecutive =
      prog.last_qualifying_date &&
      new Date(prog.last_qualifying_date).toISOString().slice(0, 10) === yesterdayStr;

    const newStreak = isConsecutive ? prog.consecutive_days_completed + 1 : 1;
    const newDay = Math.min(newStreak + 1, QUALIFICATION_DAYS);
    const unlocked = newStreak >= QUALIFICATION_DAYS;

    await client.query(
      `UPDATE host_academy_progress
       SET consecutive_days_completed = $2,
           current_day = $3,
           last_qualifying_date = $4,
           unlocked = unlocked OR $5,
           unlocked_at = CASE WHEN unlocked_at IS NULL AND $5 THEN NOW() ELSE unlocked_at END,
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId, newStreak, newDay, date, unlocked]
    );

    if (unlocked) {
      await this._unlockHost(client, userId);
    }
  },

  /**
   * Reset-to-day-1 sweep for users who missed a day. Intended to be
   * run once daily by a cron job (e.g. node-cron at 00:05 UTC):
   *   await HostAcademyService.resetMissedStreaks(io)
   */
  async resetMissedStreaks(io) {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const { rows } = await db.query(
      `SELECT user_id FROM host_academy_progress
       WHERE unlocked = FALSE
         AND consecutive_days_completed > 0
         AND (last_qualifying_date IS NULL OR last_qualifying_date < $1)`,
      [yesterdayStr]
    );

    for (const { user_id } of rows) {
      await db.query(
        `UPDATE host_academy_progress
         SET current_day = 1, consecutive_days_completed = 0, updated_at = NOW()
         WHERE user_id = $1`,
        [user_id]
      );
      await this._pushProgress(io, user_id);
    }
  },

  async _unlockHost(client, userId) {
    await client.query(
      `UPDATE users SET role = CASE WHEN role = 'user' THEN 'qualified_host' ELSE role END WHERE id = $1`,
      [userId]
    );
    await client.query(
      `UPDATE host_academy_progress SET badge_awarded = TRUE WHERE user_id = $1`,
      [userId]
    );
    await client.query(
      `INSERT INTO notifications (user_id, type, title, body)
       VALUES ($1, 'host_academy_unlocked', 'You''re a Rising Host! 🎉',
               'You completed Host Academy — your livestream panel is now permanently unlocked.')`,
      [userId]
    );
  },

  async getDashboard(userId) {
    const [{ rows: progRows }, { rows: logRows }] = await Promise.all([
      db.query(`SELECT * FROM host_academy_progress WHERE user_id = $1`, [userId]),
      db.query(
        `SELECT * FROM host_academy_daily_log WHERE user_id = $1 AND log_date = $2`,
        [userId, today()]
      ),
    ]);

    const prog = progRows[0] || {
      current_day: 1,
      consecutive_days_completed: 0,
      unlocked: false,
    };
    const log = logRows[0] || {
      golden_love_count: 0,
      golden_love_senders: [],
      tasks_completed: [],
      day_completed: false,
    };

    const overallProgressPct = Math.round(
      (prog.consecutive_days_completed / QUALIFICATION_DAYS) * 100
    );
    const daysRemaining = Math.max(0, QUALIFICATION_DAYS - prog.consecutive_days_completed);
    const estimatedUnlockDate = new Date();
    estimatedUnlockDate.setUTCDate(estimatedUnlockDate.getUTCDate() + daysRemaining);

    return {
      currentDay: prog.current_day,
      consecutiveDaysCompleted: prog.consecutive_days_completed,
      unlocked: !!prog.unlocked,
      goldenLoveGiftsToday: log.golden_love_count,
      goldenLoveTarget: GOLDEN_LOVE_DAILY_TARGET,
      distinctSendersToday: log.golden_love_senders.length,
      minDistinctSenders: MIN_DISTINCT_SENDERS,
      tasksCompletedToday: log.tasks_completed,
      tasksRequiredPerDay: TASKS_REQUIRED_PER_DAY,
      todayComplete: log.day_completed,
      overallProgressPct,
      estimatedUnlockDate: prog.unlocked ? null : estimatedUnlockDate.toISOString().slice(0, 10),
    };
  },

  async _pushProgress(io, userId) {
    if (!io) return;
    try {
      const dashboard = await this.getDashboard(userId);
      io.to(`user:${userId}`).emit("hostAcademy:progress", dashboard);
    } catch (err) {
      console.error("[hostAcademyService._pushProgress] error:", err);
    }
  },
};

module.exports = HostAcademyService;