const db = require("../config/db");

const toInt = (val) => parseInt(val || "0", 10);

const AdminController = {

    // =====================================================
    // DASHBOARD
    // =====================================================
    async dashboard(req, res, next) {
        try {
            const [
                users,
                liveRooms,
                gifts,
                payments,
                withdrawals
            ] = await Promise.all([
                db.query(`SELECT COUNT(*) FROM users`),

                db.query(`
                    SELECT COUNT(*)
                    FROM live_rooms
                    WHERE status='live'
                `),

                db.query(`SELECT COUNT(*) FROM gifts`),

                db.query(`
                    SELECT COALESCE(SUM(amount),0) AS total
                    FROM payment_transactions
                    WHERE status='success'
                `),

                db.query(`
                    SELECT COUNT(*)
                    FROM withdrawal_requests
                    WHERE status='pending'
                `)
            ]);

            return res.json({
                success: true,
                data: {
                    totalUsers: toInt(users.rows[0]?.count),
                    activeLiveRooms: toInt(liveRooms.rows[0]?.count),
                    totalGifts: toInt(gifts.rows[0]?.count),
                    totalRevenue: payments.rows[0]?.total || 0,
                    pendingWithdrawals: toInt(withdrawals.rows[0]?.count)
                }
            });

        } catch (err) {
            next(err);
        }
    },

    // =====================================================
    // USERS
    // =====================================================
    async users(req, res, next) {
        try {
            const { rows } = await db.query(`
                SELECT
                    id,
                    username,
                    email,
                    role,
                    status,
                    coin_balance,
                    earnings_balance,
                    is_verified,
                    created_at
                FROM users
                ORDER BY created_at DESC
            `);

            return res.json({ success: true, data: rows });

        } catch (err) {
            next(err);
        }
    },

    // =====================================================
    // USER DETAILS
    // =====================================================
    async userDetails(req, res, next) {
        try {
            const { rows } = await db.query(
                `SELECT * FROM users WHERE id=$1`,
                [req.params.id]
            );

            if (!rows.length) {
                return res.status(404).json({
                    success: false,
                    message: "User not found"
                });
            }

            return res.json({ success: true, data: rows[0] });

        } catch (err) {
            next(err);
        }
    },

    // =====================================================
    // UPDATE STATUS
    // =====================================================
    async updateUserStatus(req, res, next) {
        try {
            const { status } = req.body;

            const { rows } = await db.query(
                `UPDATE users SET status=$1 WHERE id=$2 RETURNING *`,
                [status, req.params.id]
            );

            if (!rows.length) {
                return res.status(404).json({
                    success: false,
                    message: "User not found"
                });
            }

            return res.json({ success: true, data: rows[0] });

        } catch (err) {
            next(err);
        }
    },

    // =====================================================
    // UPDATE ROLE
    // =====================================================
    async updateUserRole(req, res, next) {
        try {
            const { role } = req.body;

            const { rows } = await db.query(
                `UPDATE users SET role=$1 WHERE id=$2 RETURNING *`,
                [role, req.params.id]
            );

            if (!rows.length) {
                return res.status(404).json({
                    success: false,
                    message: "User not found"
                });
            }

            return res.json({ success: true, data: rows[0] });

        } catch (err) {
            next(err);
        }
    },

    // =====================================================
    // DELETE USER
    // =====================================================
    async deleteUser(req, res, next) {
        try {
            const { rows } = await db.query(
                `DELETE FROM users WHERE id=$1 RETURNING id, username`,
                [req.params.id]
            );

            if (!rows.length) {
                return res.status(404).json({
                    success: false,
                    message: "User not found"
                });
            }

            return res.json({
                success: true,
                message: "User deleted",
                data: rows[0]
            });

        } catch (err) {
            next(err);
        }
    },

    // =====================================================
    // VERIFICATIONS
    // =====================================================
    async verificationRequests(req, res, next) {
        try {
            const { rows } = await db.query(`
                SELECT vr.*, u.username, u.email
                FROM verification_requests vr
                JOIN users u ON u.id = vr.user_id
                ORDER BY vr.created_at DESC
            `);

            return res.json({ success: true, data: rows });

        } catch (err) {
            next(err);
        }
    },

    async reviewVerification(req, res, next) {
        try {
            const { status, adminNote } = req.body;

            const { rows } = await db.query(
                `
                UPDATE verification_requests
                SET status=$1, admin_note=$2, reviewed_at=now()
                WHERE id=$3
                RETURNING *
                `,
                [status, adminNote, req.params.id]
            );

            if (!rows.length) {
                return res.status(404).json({
                    success: false,
                    message: "Verification request not found"
                });
            }

            await db.query(
                `
                UPDATE users
                SET is_verified=$1
                WHERE id=(SELECT user_id FROM verification_requests WHERE id=$2)
                `,
                [status === "approved", req.params.id]
            );

            return res.json({ success: true, data: rows[0] });

        } catch (err) {
            next(err);
        }
    },

    // =====================================================
    // WITHDRAWALS
    // =====================================================
    async withdrawals(req, res, next) {
        try {
            const { rows } = await db.query(`
                SELECT w.*, u.username, u.email
                FROM withdrawal_requests w
                JOIN users u ON u.id = w.user_id
                ORDER BY w.created_at DESC
            `);

            return res.json({ success: true, data: rows });

        } catch (err) {
            next(err);
        }
    },

    async processWithdrawal(req, res, next) {
        try {
            const { status, adminNote } = req.body;

            const { rows } = await db.query(
                `
                UPDATE withdrawal_requests
                SET status=$1, admin_note=$2, processed_at=now()
                WHERE id=$3
                RETURNING *
                `,
                [status, adminNote, req.params.id]
            );

            if (!rows.length) {
                return res.status(404).json({
                    success: false,
                    message: "Withdrawal not found"
                });
            }

            return res.json({ success: true, data: rows[0] });

        } catch (err) {
            next(err);
        }
    },

    // =====================================================
    // REPORTS
    // =====================================================
    async reports(req, res, next) {
        try {
            const { rows } = await db.query(`
                SELECT r.*,
                       ru.username AS reported_username,
                       re.username AS reporter_username
                FROM reports r
                LEFT JOIN users ru ON ru.id = r.reported_user_id
                LEFT JOIN users re ON re.id = r.reporter_id
                ORDER BY r.created_at DESC
            `);

            return res.json({ success: true, data: rows });

        } catch (err) {
            next(err);
        }
    },

    // =====================================================
    // LIVE ROOMS
    // =====================================================
    async liveRooms(req, res, next) {
        try {
            const { rows } = await db.query(`
                SELECT lr.*, u.username
                FROM live_rooms lr
                JOIN users u ON u.id = lr.host_id
                ORDER BY lr.started_at DESC
            `);

            return res.json({ success: true, data: rows });

        } catch (err) {
            next(err);
        }
    },

    async liveRoomDetails(req, res, next) {
        try {
            const { rows } = await db.query(
                `SELECT * FROM live_rooms WHERE id=$1`,
                [req.params.id]
            );

            if (!rows.length) {
                return res.status(404).json({
                    success: false,
                    message: "Room not found"
                });
            }

            return res.json({ success: true, data: rows[0] });

        } catch (err) {
            next(err);
        }
    },

    // =====================================================
    // PAYMENTS
    // =====================================================
    async payments(req, res, next) {
        try {
            const { rows } = await db.query(`
                SELECT p.*, u.username
                FROM payment_transactions p
                JOIN users u ON u.id = p.user_id
                ORDER BY p.created_at DESC
            `);

            return res.json({ success: true, data: rows });

        } catch (err) {
            next(err);
        }
    },

    // =====================================================
    // GIFTS
    // =====================================================
    async gifts(req, res, next) {
        try {
            const { rows } = await db.query(`SELECT * FROM gifts`);
            return res.json({ success: true, data: rows });

        } catch (err) {
            next(err);
        }
    },

    async createGift(req, res, next) {
        try {
            const { name, price_coins } = req.body;

            const { rows } = await db.query(
                `INSERT INTO gifts(name, price_coins) VALUES($1,$2) RETURNING *`,
                [name, price_coins]
            );

            return res.status(201).json({ success: true, data: rows[0] });

        } catch (err) {
            next(err);
        }
    },

    async updateGift(req, res, next) {
        try {
            const { name, price_coins } = req.body;

            const { rows } = await db.query(
                `UPDATE gifts SET name=$1, price_coins=$2 WHERE id=$3 RETURNING *`,
                [name, price_coins, req.params.id]
            );

            if (!rows.length) {
                return res.status(404).json({
                    success: false,
                    message: "Gift not found"
                });
            }

            return res.json({ success: true, data: rows[0] });

        } catch (err) {
            next(err);
        }
    },

    async deleteGift(req, res, next) {
        try {
            const { rows } = await db.query(
                `DELETE FROM gifts WHERE id=$1 RETURNING *`,
                [req.params.id]
            );

            if (!rows.length) {
                return res.status(404).json({
                    success: false,
                    message: "Gift not found"
                });
            }

            return res.json({ success: true });

        } catch (err) {
            next(err);
        }
    },

    // =====================================================
    // ANALYTICS
    // =====================================================
    async analytics(req, res, next) {
        try {
            const [
                users,
                streamers,
                rooms,
                calls,
                messages,
                gifts
            ] = await Promise.all([
                db.query(`SELECT COUNT(*) FROM users`),
                db.query(`SELECT COUNT(*) FROM users WHERE role='streamer'`),
                db.query(`SELECT COUNT(*) FROM live_rooms`),
                db.query(`SELECT COUNT(*) FROM calls`),
                db.query(`SELECT COUNT(*) FROM messages`),
                db.query(`SELECT COUNT(*) FROM gift_transactions`)
            ]);

            return res.json({
                success: true,
                data: {
                    users: toInt(users.rows[0].count),
                    streamers: toInt(streamers.rows[0].count),
                    rooms: toInt(rooms.rows[0].count),
                    calls: toInt(calls.rows[0].count),
                    messages: toInt(messages.rows[0].count),
                    gifts: toInt(gifts.rows[0].count)
                }
            });

        } catch (err) {
            next(err);
        }
    },

    // =====================================================
    // REVENUE
    // =====================================================
    async revenue(req, res, next) {
        try {
            const revenue = await db.query(`
                SELECT COALESCE(SUM(amount),0) AS total
                FROM payment_transactions
                WHERE status='success'
            `);

            return res.json({
                success: true,
                data: revenue.rows[0]
            });

        } catch (err) {
            next(err);
        }
    },

    // =====================================================
    // LOGS
    // =====================================================
    async logs(req, res, next) {
        try {
            const { rows } = await db.query(`
                SELECT * FROM admin_logs ORDER BY created_at DESC
            `);

            return res.json({ success: true, data: rows });

        } catch (err) {
            next(err);
        }
    },

    // =====================================================
    // SETTINGS
    // =====================================================
    async settings(req, res, next) {
        try {
            const { rows } = await db.query(`
                SELECT * FROM system_settings ORDER BY setting_key
            `);

            return res.json({ success: true, data: rows });

        } catch (err) {
            next(err);
        }
    },

    async updateSetting(req, res, next) {
        try {
            const { value } = req.body;

            const { rows } = await db.query(
                `UPDATE system_settings SET setting_value=$1 WHERE setting_key=$2 RETURNING *`,
                [value, req.params.key]
            );

            return res.json({ success: true, data: rows[0] });

        } catch (err) {
            next(err);
        }
    }
};

module.exports = AdminController;