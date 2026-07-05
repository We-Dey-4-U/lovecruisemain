const db = require("../config/db");

const list = async (req, res, next) => {
    try {
        const { rows } = await db.query(
            `
            SELECT *
            FROM notifications
            WHERE user_id=$1
            ORDER BY created_at DESC
            `,
            [req.user.id]
        );

        return res.json({
            success: true,
            data: rows
        });

    } catch (err) {
        return next(err);
    }
};

const markRead = async (req, res, next) => {
    try {
        const { rows } = await db.query(
            `
            UPDATE notifications
            SET is_read=true
            WHERE id=$1
            AND user_id=$2
            RETURNING *
            `,
            [
                req.params.id,
                req.user.id
            ]
        );

        return res.json({
            success: true,
            data: rows[0] || null
        });

    } catch (err) {
        return next(err);
    }
};

const markAllRead = async (req, res, next) => {
    try {
        await db.query(
            `
            UPDATE notifications
            SET is_read=true
            WHERE user_id=$1
            `,
            [req.user.id]
        );

        return res.json({
            success: true
        });

    } catch (err) {
        return next(err);
    }
};

module.exports = {
    list,
    markRead,
    markAllRead
};