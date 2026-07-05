const db = require("../config/db");

const StoryController = {

    async create(req, res, next) {
    try {

        const {
            mediaUrl,
            mediaType = "image",
            caption
        } = req.body;

        const expiresAt = new Date(
            Date.now() + 24 * 60 * 60 * 1000
        );

        const { rows } = await db.query(
            `
            INSERT INTO stories
            (
                user_id,
                media_url,
                media_type,
                caption,
                expires_at
            )
            VALUES($1,$2,$3,$4,$5)
            RETURNING *
            `,
            [
                req.user.id,
                mediaUrl,
                mediaType,
                caption,
                expiresAt
            ]
        );

        return res.status(201).json({
            success: true,
            data: rows[0]
        });

    } catch (err) {
        return next(err);
    }
},



    async feed(req, res, next) {
        try {
            const { rows } = await db.query(
                `
                SELECT
                    s.*,
                    u.username,
                    u.avatar_url
                FROM stories s
                JOIN users u ON u.id = s.user_id
                WHERE s.expires_at > NOW()
                ORDER BY s.created_at DESC
                `
            );

            return res.json({
                success: true,
                data: rows
            });

        } catch (err) {
            return next(err);
        }
    },

    async view(req, res, next) {
        try {
            await db.query(
                `
                INSERT INTO story_views (story_id, viewer_id)
                VALUES ($1, $2)
                ON CONFLICT DO NOTHING
                `,
                [
                    req.params.id,
                    req.user.id
                ]
            );

            return res.json({
                success: true
            });

        } catch (err) {
            return next(err);
        }
    },

    async delete(req, res, next) {
        try {
            await db.query(
                `
                DELETE FROM stories
                WHERE id = $1
                AND user_id = $2
                `,
                [
                    req.params.id,
                    req.user.id
                ]
            );

            return res.json({
                success: true
            });

        } catch (err) {
            return next(err);
        }
    }
};

module.exports = StoryController;