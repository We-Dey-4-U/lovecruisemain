/* ============================================================
   backend/src/controllers/userController.js
   ============================================================ */

const db   = require("../config/db");
const User = require("../models/user");

const UserController = {

/* ----------------------------------------------------------
     GET /api/users/:id
     Returns profile + follower/following counts +
     whether the requesting user follows this person.
  ---------------------------------------------------------- */
  async getProfile(req, res, next) {
    try {
      const user = await User.findById(req.params.id);
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      /* Enrich with social counts */
      const { rows: [counts] } = await db.query(
        `
        SELECT
          (SELECT COUNT(*) FROM followers WHERE following_id = $1)::int  AS followers_count,
          (SELECT COUNT(*) FROM followers WHERE follower_id  = $1)::int  AS following_count,
          (SELECT COUNT(*) FROM gift_transactions WHERE receiver_id = $1)::int AS gifts_received_count,
          (SELECT COUNT(*) FROM live_rooms WHERE host_id = $1)::int      AS stream_count
        `,
        [user.id]
      );

      /* Is the requesting user following this profile? */
      const { rows: [followRow] } = await db.query(
        `SELECT 1 FROM followers WHERE follower_id = $1 AND following_id = $2`,
        [req.user.id, user.id]
      );

      res.json({
        success: true,
        data: {
          ...user,
          ...counts,
          is_following: !!followRow
        }
      });
    } catch (err) {
      next(err);
    }
  },

  /* ----------------------------------------------------------
     PATCH /api/users/me
     Accepts: display_name, username, bio, gender, country,
              interests[], avatar_url, cover_url
  ---------------------------------------------------------- */
 /* ----------------------------------------------------------
   PATCH /api/users/me
---------------------------------------------------------- */
async updateMe(req, res, next) {
  try {

    const allowed = [
      "display_name",
      "username",
      "bio",
      "gender",
      "country",
      "interests",
      "avatar_url",
      "cover_url"
    ];

    const updates = {};

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({
        success: false,
        message: "Nothing to update"
      });
    }

    /* =========================================================
       USERNAME UNIQUENESS CHECK (FIXED FOR UUIDs)
    ========================================================= */
    if (updates.username) {

      const username = updates.username.trim();

      const { rows } = await db.query(
        `
        SELECT id
        FROM users
        WHERE LOWER(username) = LOWER($1)
        LIMIT 1
        `,
        [username]
      );

      const existing = rows[0];

      console.log("USERNAME CHECK");
      console.log("existing.id =", existing?.id);
      console.log("req.user.id =", req.user.id);
      console.log(
        "same user =",
        existing?.id === req.user.id
      );

      // IMPORTANT FIX: compare as strings (UUID safe)
      if (existing && String(existing.id) !== String(req.user.id)) {
        return res.status(409).json({
          success: false,
          message: "Username already taken"
        });
      }

      // store cleaned username
      updates.username = username;
    }

    /* =========================================================
       BUILD DYNAMIC UPDATE QUERY
    ========================================================= */
    const setClauses = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {

      if (key === "interests") {
        setClauses.push(`"interests" = $${idx}::text[]`);
      } else {
        setClauses.push(`"${key}" = $${idx}`);
      }

      values.push(value);
      idx++;
    }

    setClauses.push(`updated_at = NOW()`);

    values.push(req.user.id);

    const query = `
      UPDATE users
      SET ${setClauses.join(", ")}
      WHERE id = $${idx}
      RETURNING
        id,
        username,
        display_name,
        avatar_url,
        cover_url,
        bio,
        gender,
        country,
        interests,
        is_verified,
        coin_balance,
        role,
        created_at
    `;

    const { rows } = await db.query(query, values);

    return res.json({
      success: true,
      data: rows[0]
    });

  } catch (err) {

    console.error("UPDATE PROFILE ERROR");
    console.error(err);
    console.error("MESSAGE:", err.message);
    console.error("DETAIL:", err.detail);
    console.error("CODE:", err.code);

    return res.status(500).json({
      success: false,
      message: err.message,
      detail: err.detail,
      code: err.code
    });
  }
},

  /* ----------------------------------------------------------
     GET /api/users/discover
  ---------------------------------------------------------- */
  async discover(req, res, next) {
    try {
      const interests = req.query.interests ? req.query.interests.split(",") : undefined;
      const users = await User.discover({
        excludeUserId: req.user.id,
        interests,
        country: req.query.country,
        limit:  Number(req.query.limit)  || 20,
        offset: Number(req.query.offset) || 0
      });
      res.json({ success: true, data: users });
    } catch (err) {
      next(err);
    }
  },

  /* ----------------------------------------------------------
     FRIEND REQUESTS
  ---------------------------------------------------------- */
  async sendFriendRequest(req, res, next) {
    try {
      const { receiverId } = req.body;
      if (receiverId === req.user.id) {
        return res.status(400).json({ success: false, message: "Cannot friend yourself" });
      }
      const { rows } = await db.query(
        `INSERT INTO friend_requests (sender_id, receiver_id) VALUES ($1, $2)
         ON CONFLICT (sender_id, receiver_id)
         DO UPDATE SET status = 'pending'
         RETURNING *`,
        [req.user.id, receiverId]
      );
      res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  },

  async respondFriendRequest(req, res, next) {
    try {
      const { accept } = req.body;
      const { rows } = await db.query(
        `UPDATE friend_requests
         SET status = $1, responded_at = now()
         WHERE id = $2 AND receiver_id = $3
         RETURNING *`,
        [accept ? "accepted" : "declined", req.params.id, req.user.id]
      );
      const request = rows[0];
      if (!request) {
        return res.status(404).json({ success: false, message: "Request not found" });
      }
      if (accept) {
        const [a, b] = [request.sender_id, request.receiver_id].sort();
        await db.query(
          `INSERT INTO friendships (user_id_a, user_id_b)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [a, b]
        );
      }
      res.json({ success: true, data: request });
    } catch (err) {
      next(err);
    }
  },

  async listFriends(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT u.id, u.username, u.display_name, u.avatar_url, u.is_verified
         FROM friendships f
         JOIN users u ON u.id = CASE
           WHEN f.user_id_a = $1 THEN f.user_id_b
           ELSE f.user_id_a
         END
         WHERE f.user_id_a = $1 OR f.user_id_b = $1`,
        [req.user.id]
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },

  /* ----------------------------------------------------------
     BLOCK
  ---------------------------------------------------------- */
  async blockUser(req, res, next) {
    try {
      const { userId } = req.body;
      await db.query(
        `INSERT INTO blocks (blocker_id, blocked_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.user.id, userId]
      );
      res.status(201).json({ success: true });
    } catch (err) {
      next(err);
    }
  },

  /* ----------------------------------------------------------
     FOLLOW / UNFOLLOW
  ---------------------------------------------------------- */
  async followUser(req, res, next) {
    try {
      const followingId = req.params.id;
      const followerId  = req.user.id;
      if (followingId === followerId) {
        return res.status(400).json({ success: false, message: "Cannot follow yourself" });
      }
      await db.query(
        `INSERT INTO followers (follower_id, following_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [followerId, followingId]
      );
      res.status(201).json({ success: true, message: "User followed" });
    } catch (err) {
      next(err);
    }
  },




async giftHistory(req, res) {
  try {

    const { rows } = await db.query(
      `
      SELECT
        gt.*,
        g.name AS gift_name,
        g.icon_url,
        u.username AS sender_username,
        u.avatar_url AS sender_avatar
      FROM gift_transactions gt
      LEFT JOIN gifts g
        ON g.id = gt.gift_id
      LEFT JOIN users u
        ON u.id = gt.sender_id
      WHERE gt.receiver_id = $1
      ORDER BY gt.created_at DESC
      `,
      [req.params.id]
    );

    res.json({
      success: true,
      data: rows
    });

  } catch (err) {

    console.error("GIFT HISTORY ERROR");
    console.error(err);

    res.status(500).json({
      success: false,
      message: err.message
    });

  }
},



  async unfollowUser(req, res, next) {
    try {
      await db.query(
        `DELETE FROM followers WHERE follower_id = $1 AND following_id = $2`,
        [req.user.id, req.params.id]
      );
      res.json({ success: true, message: "User unfollowed" });
    } catch (err) {
      next(err);
    }
  },

  /* ----------------------------------------------------------
     VERIFICATION
  ---------------------------------------------------------- */
  async submitVerification(req, res, next) {
    try {
      const { documentUrl } = req.body;
      await db.query(
        `INSERT INTO verification_requests (user_id, document_url)
         VALUES ($1, $2)`,
        [req.user.id, documentUrl]
      );
      res.json({ success: true, message: "Verification request submitted" });
    } catch (err) {
      next(err);
    }
  },

  /* ----------------------------------------------------------
     CURRENT LIVE ROOM
  ---------------------------------------------------------- */
  async currentRoom(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT up.current_room_id, lr.title, lr.host_id, lr.viewer_count
         FROM user_presence up
         JOIN live_rooms lr ON lr.id = up.current_room_id
         WHERE up.user_id = $1`,
        [req.params.id]
      );
      if (!rows.length) {
        return res.status(404).json({ success: false, message: "User is not in a live room" });
      }
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  }
};

module.exports = UserController;