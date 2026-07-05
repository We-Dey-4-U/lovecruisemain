const db = require("../config/db");

module.exports = (io, socket) => {

socket.on("joinRoom", async ({ roomId, userId }) => {

    try {

        socket.join(`room:${roomId}`);

        socket.currentRoomId = roomId;
        socket.currentUserId = userId;

        // 🔥 FIX: UPDATE USER PRESENCE HERE (REAL-TIME SOURCE OF TRUTH)
        await db.query(
            `
            INSERT INTO user_presence
            (
                user_id,
                socket_id,
                is_online,
                current_room_id,
                last_seen_at
            )
            VALUES
            (
                $1,
                $2,
                TRUE,
                $3,
                NOW()
            )
            ON CONFLICT (user_id)
            DO UPDATE SET
                socket_id = EXCLUDED.socket_id,
                is_online = TRUE,
                current_room_id = EXCLUDED.current_room_id,
                last_seen_at = NOW()
            `,
            [
                userId,
                socket.id,
                roomId
            ]
        );

        const room =
            io.sockets.adapter.rooms.get(`room:${roomId}`);

        const viewerCount = room ? room.size : 0;

        await db.query(
            `
            UPDATE live_rooms
            SET viewer_count = $2
            WHERE id = $1
            `,
            [roomId, viewerCount]
        );

        io.to(`room:${roomId}`).emit(
            "viewerCountUpdated",
            {
                roomId,
                viewerCount
            }
        );

    } catch (error) {
        console.error("joinRoom socket error:", error);
    }

});


socket.on(
  "viewerJoined",
  ({ roomId }) => {

    socket.to(
      `room:${roomId}`
    ).emit(
      "createOffer",
      {
        viewerSocketId:
          socket.id
      }
    );

  }
);



socket.on(
  "offer",
  ({
    viewerSocketId,
    offer
  }) => {

    io.to(
      viewerSocketId
    ).emit(
      "offer",
      {
        offer
      }
    );

  }
);



socket.on(
  "answer",
  ({
    roomId,
    answer
  }) => {

    socket.to(
      `room:${roomId}`
    ).emit(
      "answer",
      {
        answer
      }
    );

  }
);


socket.on(
  "iceCandidate",
  payload => {

    socket.to(
      `room:${payload.roomId}`
    ).emit(
      "iceCandidate",
      {
        candidate:
          payload.candidate
      }
    );

  }
);

socket.on("leaveRoom", async ({ roomId }) => {

    try {

        socket.leave(`room:${roomId}`);

        const room =
            io.sockets.adapter.rooms.get(
                `room:${roomId}`
            );

        const viewerCount =
            room
                ? room.size
                : 0;

        await db.query(
            `
            UPDATE live_rooms
            SET viewer_count = $2
            WHERE id = $1
            `,
            [
                roomId,
                viewerCount
            ]
        );

        io.to(`room:${roomId}`)
            .emit(
                "viewerCountUpdated",
                {
                    roomId,
                    viewerCount
                }
            );

    } catch (error) {

        console.error(
            "leaveRoom socket error:",
            error
        );

    }

});

socket.on(
    "streamComment",
    async (payload) => {

        try {

            await db.query(
                `
                INSERT INTO live_room_messages
                (
                    room_id,
                    user_id,
                    body,
                    message_type
                )
                VALUES
                (
                    $1,
                    $2,
                    $3,
                    'comment'
                )
                `,
                [
                    payload.roomId,
                    payload.userId,
                    payload.text
                ]
            );

            io.to(
                `room:${payload.roomId}`
            ).emit(
                "newComment",
                payload
            );

        } catch (error) {

            console.error(
                "streamComment error:",
                error
            );

        }

    }
);

socket.on(
    "streamReaction",
    async (payload) => {

        try {

            io.to(
                `room:${payload.roomId}`
            ).emit(
                "newReaction",
                payload
            );

        } catch (error) {

            console.error(
                "streamReaction error:",
                error
            );

        }

    }
);

socket.on(
    "sendGift",
    async (payload) => {

        try {

            io.to(
                `room:${payload.roomId}`
            ).emit(
                "giftReceived",
                payload
            );

            io.to(
                `user:${payload.receiverId}`
            ).emit(
                "giftNotification",
                payload
            );

            const leaderboard =
                await db.query(
                    `
                    SELECT
                        u.id,
                        u.username,
                        u.avatar_url,
                        COALESCE(
                            SUM(
                                gt.total_coins
                            ),
                            0
                        ) total
                    FROM gift_transactions gt
                    JOIN users u
                        ON u.id =
                        gt.sender_id
                    WHERE
                        gt.context_type =
                        'live_room'
                    AND
                        gt.context_id = $1
                    GROUP BY
                        u.id,
                        u.username,
                        u.avatar_url
                    ORDER BY
                        total DESC
                    LIMIT 3
                    `,
                    [
                        payload.roomId
                    ]
                );

            io.to(
                `room:${payload.roomId}`
            ).emit(
                "topGiftersUpdated",
                leaderboard.rows
            );

        } catch (error) {

            console.error(
                "sendGift error:",
                error
            );

        }

    }
);

socket.on("disconnect", async () => {
    try {

        const userId = socket.currentUserId;
        const roomId = socket.currentRoomId;

        if (userId) {
            await db.query(
                `
                UPDATE user_presence
                SET 
                    is_online = FALSE,
                    socket_id = NULL,
                    current_room_id = NULL,
                    last_seen_at = NOW()
                WHERE user_id = $1
                `,
                [userId]
            );
        }

        if (!roomId) return;

        const room =
            io.sockets.adapter.rooms.get(`room:${roomId}`);

        const viewerCount = room ? room.size : 0;

        await db.query(
            `
            UPDATE live_rooms
            SET viewer_count = $2
            WHERE id = $1
            `,
            [roomId, viewerCount]
        );

        io.to(`room:${roomId}`).emit(
            "viewerCountUpdated",
            {
                roomId,
                viewerCount
            }
        );

    } catch (error) {
        console.error("stream disconnect error:", error);
    }
});


};