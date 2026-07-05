const db = require("../config/db");

module.exports = (io, socket) => {

    socket.on("registerUser", async (userId) => {

        try {

            socket.join(`user:${userId}`);

            await db.query(
                `
                INSERT INTO user_presence
                (
                    user_id,
                    socket_id,
                    is_online,
                    last_seen_at
                )
                VALUES
                (
                    $1,
                    $2,
                    true,
                    now()
                )

                ON CONFLICT(user_id)
                DO UPDATE SET
                    socket_id = $2,
                    is_online = true,
                    last_seen_at = now()
                `,
                [userId, socket.id]
            );

            io.emit("userOnline", { userId });

        } catch (error) {

            console.error(
                "registerUser socket error:",
                error
            );

        }

    });

    socket.on("disconnect", async () => {

        try {

           const result =
    await db.query(
        `
        UPDATE user_presence
        SET
            is_online = false,
            last_seen_at = now()
        WHERE socket_id = $1
        RETURNING user_id
        `,
        [socket.id]
    );

if (result.rows.length) {

    io.emit(
        "userOffline",
        {
            userId:
                result.rows[0].user_id
        }
    );

}
        } catch (error) {

            console.error(
                "disconnect socket error:",
                error
            );

        }

    });

};